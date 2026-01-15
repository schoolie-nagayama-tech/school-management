// PDF出力用のユーティリティ関数

export async function exportProgressToPDF(
  elementId: string,
  filename: string
): Promise<void> {
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

  // 一時的に幅を固定（PDF用）
  const originalWidth = element.style.width;
  element.style.width = '800px';

  try {
    // HTML要素をCanvasに変換
    const canvas = await html2canvas(element, {
      scale: 2, // 高解像度
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    // Canvas画像のサイズ
    const imgWidth = 210; // A4幅（mm）
    const pageHeight = 297; // A4高さ（mm）
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    // PDFを作成
    const pdf = new jsPDF('p', 'mm', 'a4');
    
    let heightLeft = imgHeight;
    let position = 0;

    // 最初のページ
    pdf.addImage(
      canvas.toDataURL('image/png'),
      'PNG',
      0,
      position,
      imgWidth,
      imgHeight
    );
    heightLeft -= pageHeight;

    // 複数ページ対応
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(
        canvas.toDataURL('image/png'),
        'PNG',
        0,
        position,
        imgWidth,
        imgHeight
      );
      heightLeft -= pageHeight;
    }

    // ダウンロード
    pdf.save(filename);
  } finally {
    // 幅を元に戻す
    element.style.width = originalWidth;
  }
}
