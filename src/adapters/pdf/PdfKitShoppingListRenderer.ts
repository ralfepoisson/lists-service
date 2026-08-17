import PDFDocument from 'pdfkit';

import type {
  PrintableShoppingList,
  ShoppingListPdfRenderer
} from '../../application/ports/ShoppingListPdfRenderer.js';

export class PdfKitShoppingListRenderer implements ShoppingListPdfRenderer {
  async render(list: PrintableShoppingList): Promise<Buffer> {
    return await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const document = new PDFDocument({
        autoFirstPage: false,
        bufferPages: true,
        info: {
          Title: list.title,
          Author: 'Life Squared',
          Subject: 'Current active shopping-list items',
          CreationDate: list.generatedAt
        },
        margin: 54,
        size: 'A4'
      });

      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);

      document.addPage();
      document.font('Helvetica-Bold').fontSize(24).fillColor('#223127').text(list.title);
      document.moveDown(0.35);
      document
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#647269')
        .text(`Generated ${this.formatGeneratedAt(list.generatedAt)}`);
      document.moveDown(1.25);

      if (list.items.length === 0) {
        document.fontSize(12).fillColor('#4b5d52').text('There are no active items.');
      } else {
        for (const [index, item] of list.items.entries()) {
          document.font('Helvetica').fontSize(12);
          const itemHeight = document.heightOfString(item.content, { width: 460 });
          this.ensureLineSpace(document, list.title, itemHeight + 20);
          const top = document.y;
          document
            .lineWidth(1)
            .strokeColor('#9db5a4')
            .rect(54, top + 1, 12, 12)
            .stroke();
          document
            .font('Helvetica')
            .fontSize(12)
            .fillColor('#223127')
            .text(item.content, 78, top, { width: 460 });
          document.moveDown(index === list.items.length - 1 ? 0 : 0.85);
        }
      }

      this.addPageNumberFooters(document);
      document.end();
    });
  }

  private ensureLineSpace(
    document: PDFKit.PDFDocument,
    title: string,
    requiredHeight: number
  ): void {
    const contentBottom = document.page.height - document.page.margins.bottom - 34;
    if (document.y + requiredHeight > contentBottom) {
      document.addPage();
      document
        .font('Helvetica-Bold')
        .fontSize(14)
        .fillColor('#223127')
        .text(`${title} (continued)`);
      document.moveDown(1);
    }
  }

  private addPageNumberFooters(document: PDFKit.PDFDocument): void {
    const pages = document.bufferedPageRange();
    for (let index = pages.start; index < pages.start + pages.count; index += 1) {
      document.switchToPage(index);
      document
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#647269')
        .text(
          `Page ${index + 1} of ${pages.count}`,
          54,
          document.page.height - document.page.margins.bottom - 12,
          {
            align: 'center',
            lineBreak: false,
            width: document.page.width - 108
          }
        );
    }
  }

  private formatGeneratedAt(value: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short'
    }).format(value);
  }
}
