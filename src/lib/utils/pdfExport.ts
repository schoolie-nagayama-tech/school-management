// PDF出力用のユーティリティ関数

export async function exportProgressToPDF(
  elementId: string,
  filename: string,
  options?: {
    fitToPage?: boolean; // 1ページに収めるかどうか
    orientation?: 'portrait' | 'landscape'; // 縦向き or 横向き
  }
): Promise<void> {
  const { fitToPage = false, orientation = 'portrait' } = options || {};

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
  const originalStyles = {
    width: element.style.width,
    fontSize: element.style.fontSize,
    transform: element.style.transform,
  };

  try {
    if (fitToPage) {
      // 1ページに収める場合：フォントサイズ縮小・表が切れないよう体裁を整える
      element.style.width = orientation === 'landscape' ? '1400px' : '800px';
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
      element.style.width = '800px';
    }

    // HTML要素をCanvasに変換
    const canvas = await html2canvas(element, {
      scale: fitToPage ? 1.5 : 2, // 1ページ収める場合は少しスケールを下げる
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    // PDFのサイズ設定
    const isLandscape = orientation === 'landscape';
    const pageWidth = isLandscape ? 297 : 210; // A4横向き幅（mm）or 縦向き幅
    const pageHeight = isLandscape ? 210 : 297; // A4横向き高さ（mm）or 縦向き高さ

    // Canvas画像のサイズを計算
    const imgWidth = pageWidth - 10; // マージン5mm x 2
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    // PDFを作成
    const pdf = new jsPDF(isLandscape ? 'l' : 'p', 'mm', 'a4');

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
