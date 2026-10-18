/**
 * Marketplace cargo label as a 100×150 mm PDF (thermal 10×15 or any printer): carrier, a Code 128 barcode of the
 * marketplace's cargo number, recipient, sender, order/package numbers. Used for Trendyol orders, whose own common
 * label ("ortak barkod") only exists as ZPL and only for Trendyol Express / Aras on Trendyol-paid cargo; the cargo
 * number barcode is what the carrier scans.
 *
 * Turkish text needs a Unicode font: the DejaVu fonts the orders export already ships (lib/export/orders.ts).
 */
import PDFDocument from 'pdfkit';
import { code128Modules } from '@/lib/barcode/code128';
import { findUnicodeFont } from '@/lib/export/orders';

export interface CargoLabelParty {
  name: string;
  lines: string[]; // street, district/city, …
  phone?: string | null;
}

export interface CargoLabelInput {
  carrier: string;
  cargoNumber: string;
  marketplace: string; // "Trendyol"
  orderNumber: string;
  packageId?: string | null;
  recipient: CargoLabelParty;
  sender?: CargoLabelParty | null;
  /** Item summary, e.g. "2 × Ahşap Kutu". */
  contents?: string | null;
  deci?: number | null;
  /** Localised captions. */
  t: { recipient: string; sender: string; order: string; package: string; contents: string; deci: string };
}

const MM = 72 / 25.4;
const W = 100 * MM;
const H = 150 * MM;
const PAD = 5 * MM;

export async function cargoLabelPdf(input: CargoLabelInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `${input.marketplace} ${input.cargoNumber}` } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const font = findUnicodeFont();
  let regular = 'Helvetica';
  let bold = 'Helvetica-Bold';
  if (font) {
    doc.registerFont('kx-regular', font.regular);
    doc.registerFont('kx-bold', font.bold);
    regular = 'kx-regular';
    bold = 'kx-bold';
  }
  const inner = W - 2 * PAD;
  let y = PAD;

  // Header: carrier + marketplace.
  doc.font(bold).fontSize(16).fillColor('#000').text(input.carrier, PAD, y, { width: inner * 0.65, lineBreak: false, ellipsis: true });
  doc.font(regular).fontSize(9).text(input.marketplace, PAD + inner * 0.65, y + 4, { width: inner * 0.35, align: 'right' });
  y += 24;
  doc.moveTo(PAD, y).lineTo(W - PAD, y).lineWidth(1).stroke();
  y += 6;

  // Barcode.
  const modules = code128Modules(input.cargoNumber);
  const total = modules.reduce((a, b) => a + b, 0);
  const quiet = 10; // modules each side
  const unit = inner / (total + 2 * quiet);
  const barH = 22 * MM;
  let x = PAD + quiet * unit;
  modules.forEach((m, i) => {
    if (i % 2 === 0) doc.rect(x, y, m * unit, barH).fill('#000');
    x += m * unit;
  });
  y += barH + 3;
  doc.font(bold).fontSize(12).fillColor('#000').text(input.cargoNumber, PAD, y, { width: inner, align: 'center', characterSpacing: 1 });
  y += 20;
  doc.moveTo(PAD, y).lineTo(W - PAD, y).lineWidth(1).stroke();
  y += 6;

  const party = (title: string, p: CargoLabelParty, nameSize: number) => {
    doc.font(regular).fontSize(7.5).fillColor('#444').text(title.toLocaleUpperCase('tr'), PAD, y);
    y = doc.y + 1;
    doc.font(bold).fontSize(nameSize).fillColor('#000').text(p.name || '-', PAD, y, { width: inner });
    y = doc.y + 1;
    for (const line of p.lines.filter(Boolean)) {
      doc.font(regular).fontSize(nameSize - 2).text(line, PAD, y, { width: inner });
      y = doc.y;
    }
    if (p.phone) {
      doc.font(regular).fontSize(nameSize - 2).text(p.phone, PAD, y, { width: inner });
      y = doc.y;
    }
    y += 5;
  };

  party(input.t.recipient, input.recipient, 12);
  doc.moveTo(PAD, y).lineTo(W - PAD, y).lineWidth(0.5).stroke();
  y += 5;
  if (input.sender) {
    party(input.t.sender, input.sender, 9);
    doc.moveTo(PAD, y).lineTo(W - PAD, y).lineWidth(0.5).stroke();
    y += 5;
  }

  const meta: Array<[string, string]> = [[input.t.order, input.orderNumber]];
  if (input.packageId) meta.push([input.t.package, String(input.packageId)]);
  if (input.deci) meta.push([input.t.deci, String(input.deci)]);
  for (const [k, v] of meta) {
    doc.font(regular).fontSize(8).fillColor('#444').text(`${k}: `, PAD, y, { continued: true }).font(bold).fillColor('#000').text(v);
    y = doc.y + 1;
  }
  if (input.contents) {
    doc.font(regular).fontSize(8).fillColor('#444').text(`${input.t.contents}: `, PAD, y, { continued: true, width: inner }).fillColor('#000').text(input.contents, { width: inner, height: H - y - PAD, ellipsis: true });
  }

  doc.end();
  return done;
}
