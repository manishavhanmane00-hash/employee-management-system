export const downloadElementPdf = async (element, filename, options = {}) => {
  if (!element) throw new Error('The document is not available for PDF export.');
  const module = await import('html2pdf.js');
  const html2pdf = module.default;
  if (typeof html2pdf !== 'function') {
    throw new Error('PDF generation is unavailable in this browser.');
  }

  await html2pdf()
    .set({
      filename,
      margin: options.margin ?? 10,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', ...options.jsPDF },
      pagebreak: { mode: ['css', 'legacy'] },
    })
    .from(element)
    .save();
};

export const printElement = (element, title) => {
  if (!element) throw new Error('The document is not available for printing.');
  const printWindow = window.open('', '_blank');
  if (!printWindow) throw new Error('Allow pop-ups to print this document.');

  printWindow.opener = null;
  const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map(link => `<link rel="stylesheet" href="${link.href}">`)
    .join('');
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${String(title || 'Document').replace(/[<>&"]/g, '')}</title>${stylesheets}<style>@page{size:A4;margin:12mm}body{margin:0;background:#fff}#document-print{width:100%;margin:0!important;border:0!important;border-radius:0!important}*{box-sizing:border-box}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}@media print{body{background:#fff!important}#document-print{box-shadow:none!important}}</style></head><body><main id="document-print">${element.outerHTML}</main></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  let didPrint = false;
  const printOnce = () => {
    if (didPrint || printWindow.closed) return;
    didPrint = true;
    printWindow.print();
  };
  printWindow.onload = printOnce;
  window.setTimeout(() => {
    printOnce();
  }, 1000);
};
