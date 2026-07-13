// PDF export — rasterizes the on-screen A4 report (#report-doc) into an A4 PDF.
//
// WHY html-to-image (foreignObject) and NOT html2canvas:
// jsPDF's own text drawing has no Arabic shaping/RTL, so drawing text directly
// mangles Arabic. html2canvas AVOIDS jsPDF text — but it RE-IMPLEMENTS text
// layout itself, and that reimplementation breaks Arabic shaping/bidi too
// (letters disconnect / overlap) while Latin + digits look fine. That is exactly
// the "garbled title in the PDF but correct in the preview" symptom.
//
// html-to-image serialises the DOM into an <svg><foreignObject>, so the BROWSER
// renders the HTML natively — identical to what you see on screen, Arabic shaping
// and all — and we only rasterise the result. jsPDF is then used ONLY to place
// that image (addImage), never to draw text. Tall reports are sliced across A4
// pages.

import jsPDF from 'jspdf';
import { toCanvas } from 'html-to-image';

/** "ملخص_الأزمات_YYYY-MM-DD.pdf" — filesystem-safe, dated to the export moment. */
export function reportFileName(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `ملخص_الأزمات_${y}-${m}-${d}.pdf`;
}

/**
 * Capture `el` (browser-native render → correct Arabic) and save it as a
 * multi-page A4 PDF named `filename`. Throws if rendering fails — the caller
 * surfaces that to the user.
 */
export async function exportReportPdf(el: HTMLElement, filename: string): Promise<void> {
  // Browser renders the DOM inside a foreignObject → Arabic shaping/RTL preserved.
  const canvas = await toCanvas(el, {
    pixelRatio: 2,               // crisp text at print size
    backgroundColor: '#ffffff',
    cacheBust: true,             // ensures the SVG logo is re-fetched + inlined
    width: el.offsetWidth,
    height: el.offsetHeight,
  });

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();    // 210mm
  const pageH = pdf.internal.pageSize.getHeight();    // 297mm
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;
  const img = canvas.toDataURL('image/png');

  // Place the (possibly tall) image, then shift it up by one page-height per
  // extra page until the whole sheet has been laid out. jsPDF clips each page.
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
