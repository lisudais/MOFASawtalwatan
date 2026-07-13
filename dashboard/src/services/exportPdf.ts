// PDF export — rasterizes the on-screen A4 report (#report-doc) and lays it into
// an A4 PDF. We capture the rendered DOM (html2canvas) rather than typesetting in
// jsPDF because jsPDF has no Arabic shaping/RTL: the browser already shapes the
// Arabic correctly, so a snapshot preserves it 100%. Tall reports are sliced
// across multiple A4 pages.

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

/** "ملخص_الأزمات_YYYY-MM-DD.pdf" — filesystem-safe, dated to the export moment. */
export function reportFileName(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `ملخص_الأزمات_${y}-${m}-${d}.pdf`;
}

/**
 * Capture `el` and save it as a multi-page A4 PDF named `filename`.
 * Throws if rendering fails — the caller surfaces that to the user.
 */
export async function exportReportPdf(el: HTMLElement, filename: string): Promise<void> {
  const canvas = await html2canvas(el, {
    scale: 2,                 // crisp text at print size
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
  });

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();   // 210mm
  const pageH = pdf.internal.pageSize.getHeight();   // 297mm
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;
  const img = canvas.toDataURL('image/png');

  // First page, then shift the same tall image up by one page-height per page
  // until the whole thing has been placed.
  let position = 0;
  let heightLeft = imgH;
  pdf.addImage(img, 'PNG', 0, position, imgW, imgH);
  heightLeft -= pageH;
  while (heightLeft > 0) {
    position -= pageH;
    pdf.addPage();
    pdf.addImage(img, 'PNG', 0, position, imgW, imgH);
    heightLeft -= pageH;
  }

  pdf.save(filename);
}
