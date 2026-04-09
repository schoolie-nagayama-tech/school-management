// PDF出力用のユーティリティ関数

export async function exportProgressToPDF(
  elementId: string,
  filename: string,
  options?: {
    fitToPage?: boolean; // 1ページに収めるかどうか
    orientation?: 'portrait' | 'landscape'; // 縦向き or 横向き
    expandScrollable?: boolean; // スクロール領域を展開して全体をキャプチャするか
    pageSize?: 'a4' | 'a3'; // 用紙サイズ（デフォルト: a4）
  }
): Promise<void> {
  const { fitToPage = false, orientation = 'portrait', expandScrollable = false, pageSize = 'a4' } = options || {};

  // html2canvas と jspdf を動的インポート
  const [html2canvasModule, jsPDFModule] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  
  const html2canvas = html2canvasModule.default;
  const { jsPDF } = jsPDFModule;

  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error('PDF出力対象の要素が見つかりません');
  }

  // 元のスタイルを保存
  const el = element as HTMLElement;
  const originalStyles = {
    width: element.style.width,
    fontSize: element.style.fontSize,
    transform: element.style.transform,
    maxHeight: el.style.maxHeight,
    overflow: el.style.overflow,
    overflowY: el.style.overflowY,
  };

  const isLandscape = orientation === 'landscape';
  const isA3 = pageSize === 'a3';

  try {
    // スクロール領域を展開：max-height/overflow を解除して全体をキャプチャ
    if (expandScrollable) {
      (element as HTMLElement).style.maxHeight = 'none';
      (element as HTMLElement).style.overflow = 'visible';
      (element as HTMLElement).style.overflowY = 'visible';
      void (element as HTMLElement).offsetHeight; // リフローを強制
    }

    if (fitToPage) {
      // 1ページに収める場合：フォントサイズ縮小・表が切れないよう体裁を整える
      const fitWidth = isA3
        ? (isLandscape ? '2000px' : '1400px')
        : (isLandscape ? '1400px' : '800px');
      element.style.width = fitWidth;
      const tables = element.querySelectorAll('table');
      tables.forEach(table => {
        (table as HTMLElement).style.fontSize = '9px';
        (table as HTMLElement).style.pageBreakInside = 'avoid';
        const cells = table.querySelectorAll('th, td');
        cells.forEach(cell => {
          (cell as HTMLElement).style.fontSize = '9px';
          (cell as HTMLElement).style.padding = '2px 4px';
        });
      });
      // セクション・見出しもコンパクトに
      const sections = element.querySelectorAll('section');
      sections.forEach(sec => {
        (sec as HTMLElement).style.pageBreakInside = 'avoid';
        (sec as HTMLElement).style.padding = '8px';
      });
    } else {
      // 通常モード：幅を固定
      element.style.width = isA3 ? (isLandscape ? '1600px' : '1100px') : '800px';
    }

    // HTML要素をCanvasに変換
    const canvas = await html2canvas(element, {
      scale: fitToPage ? 1.5 : 2, // 1ページ収める場合は少しスケールを下げる
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    // PDFのサイズ設定
    const pageWidth = isLandscape
      ? (isA3 ? 420 : 297)   // A3横: 420mm, A4横: 297mm
      : (isA3 ? 297 : 210);  // A3縦: 297mm, A4縦: 210mm
    const pageHeight = isLandscape
      ? (isA3 ? 297 : 210)   // A3横: 297mm, A4横: 210mm
      : (isA3 ? 420 : 297);  // A3縦: 420mm, A4縦: 297mm

    // Canvas画像のサイズを計算
    const imgWidth = pageWidth - 10; // マージン5mm x 2
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    // PDFを作成
    const pdf = new jsPDF(isLandscape ? 'l' : 'p', 'mm', pageSize);

    if (fitToPage && imgHeight > pageHeight - 10) {
      // 1ページに収まらない場合、スケールを調整
      const scale = (pageHeight - 10) / imgHeight;
      const scaledWidth = imgWidth * scale;
      const scaledHeight = imgHeight * scale;
      const xOffset = (pageWidth - scaledWidth) / 2;
      const yOffset = (pageHeight - scaledHeight) / 2;

      pdf.addImage(
        canvas.toDataURL('image/png'),
        'PNG',
        xOffset,
        yOffset,
        scaledWidth,
        scaledHeight
      );
    } else {
      // 通常モード：複数ページ対応
      let heightLeft = imgHeight;
      let position = 5; // 上マージン

      // 最初のページ
      pdf.addImage(
        canvas.toDataURL('image/png'),
        'PNG',
        5, // 左マージン
        position,
        imgWidth,
        imgHeight
      );
      heightLeft -= (pageHeight - 10);

      // 複数ページ対応
      while (heightLeft > 0) {
        position = heightLeft - imgHeight + 5;
        pdf.addPage();
        pdf.addImage(
          canvas.toDataURL('image/png'),
          'PNG',
          5,
          position,
          imgWidth,
          imgHeight
        );
        heightLeft -= (pageHeight - 10);
      }
    }

    // ダウンロード
    pdf.save(filename);
  } finally {
    // スタイルを元に戻す
    element.style.width = originalStyles.width;
    element.style.fontSize = originalStyles.fontSize;
    element.style.transform = originalStyles.transform;
    (element as HTMLElement).style.maxHeight = originalStyles.maxHeight ?? '';
    (element as HTMLElement).style.overflow = originalStyles.overflow ?? '';
    (element as HTMLElement).style.overflowY = '';

    // テーブル・セクションのスタイルを元に戻す
    const tables = element.querySelectorAll('table');
    tables.forEach(table => {
      (table as HTMLElement).style.fontSize = '';
      (table as HTMLElement).style.pageBreakInside = '';
      const cells = table.querySelectorAll('th, td');
      cells.forEach(cell => {
        (cell as HTMLElement).style.fontSize = '';
        (cell as HTMLElement).style.padding = '';
      });
    });
    const sections = element.querySelectorAll('section');
    sections.forEach(sec => {
      (sec as HTMLElement).style.pageBreakInside = '';
      (sec as HTMLElement).style.padding = '';
    });
  }
}
