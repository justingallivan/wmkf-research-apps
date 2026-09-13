/**
 * PDF Export Utility
 *
 * Shared utility for generating PDF reports from app results.
 * Uses pdf-lib for client-side PDF generation.
 *
 * ARCHITECTURE NOTES (for implementing in other apps):
 *
 * 1. This utility provides building blocks for PDF generation:
 *    - PDFReportBuilder: A fluent API for building PDF reports
 *    - Helper functions for common patterns (headers, sections, tables)
 *
 * 2. To add PDF export to an app:
 *    a. Import PDFReportBuilder from this file
 *    b. Create a function that builds the PDF using the builder API
 *    c. Add an "Export PDF" button that calls your function
 *    d. Use downloadPdf() to trigger the download
 *
 * 3. The builder supports:
 *    - Title and metadata
 *    - Sections with headers
 *    - Paragraphs with automatic text wrapping
 *    - Bullet lists
 *    - Key-value pairs
 *    - Horizontal dividers
 *    - Badge-style labels (for ratings, recommendations)
 *    - Page breaks
 *
 * 4. Fonts: Uses Helvetica (built into PDF spec) for broad compatibility
 *    - Regular, Bold, and Oblique variants available
 *
 * Example usage:
 * ```javascript
 * import { PDFReportBuilder, downloadPdf } from '../shared/utils/pdf-export';
 *
 * async function exportToPdf(data) {
 *   const builder = new PDFReportBuilder();
 *   await builder.init();
 *
 *   builder
 *     .addTitle('My Report')
 *     .addMetadata('Generated', new Date().toLocaleDateString())
 *     .addSection('Summary')
 *     .addParagraph(data.summary)
 *     .addSection('Details')
 *     .addBulletList(data.items);
 *
 *   const pdfBytes = await builder.build();
 *   downloadPdf(pdfBytes, 'my-report.pdf');
 * }
 * ```
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Color palette
const COLORS = {
  black: rgb(0, 0, 0),
  darkGray: rgb(0.2, 0.2, 0.2),
  gray: rgb(0.4, 0.4, 0.4),
  lightGray: rgb(0.6, 0.6, 0.6),
  veryLightGray: rgb(0.9, 0.9, 0.9),
  green: rgb(0.13, 0.55, 0.13),
  red: rgb(0.7, 0.2, 0.2),
  blue: rgb(0.2, 0.4, 0.7),
  amber: rgb(0.7, 0.5, 0.1),
  purple: rgb(0.5, 0.3, 0.7),
};

/**
 * Sanitize text for WinAnsi encoding (Helvetica only supports WinAnsi).
 * Replaces Unicode characters that pdf-lib cannot encode.
 */
export function sanitizeForPdf(text) {
  if (!text) return text;
  return text
    // Subscript digits
    .replace(/\u2080/g, '0').replace(/\u2081/g, '1').replace(/\u2082/g, '2')
    .replace(/\u2083/g, '3').replace(/\u2084/g, '4').replace(/\u2085/g, '5')
    .replace(/\u2086/g, '6').replace(/\u2087/g, '7').replace(/\u2088/g, '8')
    .replace(/\u2089/g, '9')
    // Superscript digits
    .replace(/\u2070/g, '0').replace(/\u00B9/g, '1').replace(/\u00B2/g, '2')
    .replace(/\u00B3/g, '3').replace(/\u2074/g, '4').replace(/\u2075/g, '5')
    .replace(/\u2076/g, '6').replace(/\u2077/g, '7').replace(/\u2078/g, '8')
    .replace(/\u2079/g, '9')
    // Dashes and quotes
    .replace(/\u2013/g, '-')   // en dash
    .replace(/\u2014/g, '--')  // em dash
    .replace(/\u2018/g, "'")   // left single quote
    .replace(/\u2019/g, "'")   // right single quote
    .replace(/\u201C/g, '"')   // left double quote
    .replace(/\u201D/g, '"')   // right double quote
    // Other common Unicode
    .replace(/\u2026/g, '...') // ellipsis
    .replace(/\u00A0/g, ' ')   // non-breaking space
    .replace(/\u2032/g, "'")   // prime
    .replace(/\u2033/g, '"')   // double prime
    // Arrows and comparison/math operators common in model output
    .replace(/\u2192/g, '->')  // rightwards arrow
    .replace(/\u2190/g, '<-')  // leftwards arrow
    .replace(/\u2265/g, '>=')  // greater-than or equal to
    .replace(/\u2264/g, '<=')  // less-than or equal to
    .replace(/\u2248/g, '~')   // almost equal to
    .replace(/\u2212/g, '-')   // minus sign
    // Fallback: replace any remaining non-WinAnsi chars with '?'
    // WinAnsi covers 0x20-0x7E (ASCII printable) + 0xA0-0xFF (Latin-1 Supplement)
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}

// Page settings
const PAGE_WIDTH = 612; // Letter size
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);

/**
 * PDFReportBuilder - Fluent API for building PDF reports
 */
export class PDFReportBuilder {
  constructor() {
    this.doc = null;
    this.fonts = {};
    this.currentPage = null;
    this.yPosition = PAGE_HEIGHT - MARGIN;
    this.pageNumber = 0;
  }

  /**
   * Initialize the PDF document and fonts
   */
  async init() {
    this.doc = await PDFDocument.create();
    this.fonts.regular = await this.doc.embedFont(StandardFonts.Helvetica);
    this.fonts.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.fonts.italic = await this.doc.embedFont(StandardFonts.HelveticaOblique);
    this.addPage();
    return this;
  }

  /**
   * Add a new page
   */
  addPage() {
    this.currentPage = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.yPosition = PAGE_HEIGHT - MARGIN;
    this.pageNumber++;
    return this;
  }

  /**
   * Check if we need a new page and add one if necessary
   */
  ensureSpace(neededHeight) {
    if (this.yPosition - neededHeight < MARGIN + 30) {
      this.addPage();
    }
    return this;
  }

  /**
   * Add the main title
   */
  addTitle(title, subtitle = null) {
    this.ensureSpace(60);

    this.currentPage.drawText(sanitizeForPdf(title), {
      x: MARGIN,
      y: this.yPosition,
      size: 20,
      font: this.fonts.bold,
      color: COLORS.black,
    });
    this.yPosition -= 28;

    if (subtitle) {
      this.currentPage.drawText(sanitizeForPdf(subtitle), {
        x: MARGIN,
        y: this.yPosition,
        size: 11,
        font: this.fonts.regular,
        color: COLORS.gray,
      });
      this.yPosition -= 20;
    }

    this.yPosition -= 10;
    return this;
  }

  /**
   * Add metadata line (key: value format)
   */
  addMetadata(key, value) {
    this.ensureSpace(20);

    const safeKey = sanitizeForPdf(key);
    const safeValue = sanitizeForPdf(value);
    const keyWidth = this.fonts.bold.widthOfTextAtSize(`${safeKey}: `, 10);

    this.currentPage.drawText(`${safeKey}: `, {
      x: MARGIN,
      y: this.yPosition,
      size: 10,
      font: this.fonts.bold,
      color: COLORS.gray,
    });

    this.currentPage.drawText(safeValue, {
      x: MARGIN + keyWidth,
      y: this.yPosition,
      size: 10,
      font: this.fonts.regular,
      color: COLORS.darkGray,
    });

    this.yPosition -= 16;
    return this;
  }

  /**
   * Add a section header
   */
  addSection(title, level = 1) {
    const fontSize = level === 1 ? 14 : 12;
    const topPadding = level === 1 ? 20 : 15;

    this.ensureSpace(fontSize + topPadding + 10);
    this.yPosition -= topPadding;

    this.currentPage.drawText(sanitizeForPdf(title), {
      x: MARGIN,
      y: this.yPosition,
      size: fontSize,
      font: this.fonts.bold,
      color: COLORS.darkGray,
    });

    this.yPosition -= fontSize + 8;
    return this;
  }

  /**
   * Add a paragraph with automatic text wrapping
   */
  addParagraph(text, options = {}) {
    if (!text) return this;

    const {
      fontSize = 10,
      color = COLORS.darkGray,
      font = 'regular',
      indent = 0,
    } = options;

    const selectedFont = this.fonts[font] || this.fonts.regular;
    const lines = this.wrapText(text, CONTENT_WIDTH - indent, selectedFont, fontSize);

    this.ensureSpace(lines.length * (fontSize + 4));

    for (const line of lines) {
      this.currentPage.drawText(line, {
        x: MARGIN + indent,
        y: this.yPosition,
        size: fontSize,
        font: selectedFont,
        color: color,
      });
      this.yPosition -= fontSize + 4;
    }

    this.yPosition -= 6;
    return this;
  }

  /**
   * Add a bullet list
   */
  addBulletList(items, options = {}) {
    if (!items || items.length === 0) return this;

    const { fontSize = 10, bulletChar = '•', indent = 15 } = options;

    for (const item of items) {
      const text = typeof item === 'string' ? item : String(item);
      const lines = this.wrapText(text, CONTENT_WIDTH - indent - 10, this.fonts.regular, fontSize);

      this.ensureSpace(lines.length * (fontSize + 4) + 4);

      // Draw bullet
      this.currentPage.drawText(bulletChar, {
        x: MARGIN + indent - 10,
        y: this.yPosition,
        size: fontSize,
        font: this.fonts.regular,
        color: COLORS.gray,
      });

      // Draw text lines
      for (let i = 0; i < lines.length; i++) {
        this.currentPage.drawText(lines[i], {
          x: MARGIN + indent,
          y: this.yPosition,
          size: fontSize,
          font: this.fonts.regular,
          color: COLORS.darkGray,
        });
        this.yPosition -= fontSize + 4;
      }
    }

    this.yPosition -= 4;
    return this;
  }

  /**
   * Add a key-value pair on the same line
   */
  addKeyValue(key, value, options = {}) {
    if (!value) return this;

    const { fontSize = 10, keyColor = COLORS.gray, valueColor = COLORS.darkGray } = options;

    this.ensureSpace(fontSize + 8);

    const keyText = `${sanitizeForPdf(key)}: `;
    const keyWidth = this.fonts.bold.widthOfTextAtSize(keyText, fontSize);

    this.currentPage.drawText(keyText, {
      x: MARGIN,
      y: this.yPosition,
      size: fontSize,
      font: this.fonts.bold,
      color: keyColor,
    });

    // Wrap value text (sanitized inside wrapText)
    const valueLines = this.wrapText(value, CONTENT_WIDTH - keyWidth, this.fonts.regular, fontSize);

    for (let i = 0; i < valueLines.length; i++) {
      this.currentPage.drawText(valueLines[i], {
        x: i === 0 ? MARGIN + keyWidth : MARGIN + 20,
        y: this.yPosition,
        size: fontSize,
        font: this.fonts.regular,
        color: valueColor,
      });
      this.yPosition -= fontSize + 4;
    }

    this.yPosition -= 4;
    return this;
  }

  /**
   * Add a badge-style label (for ratings, recommendations, etc.)
   */
  addBadge(label, type = 'default') {
    const colorMap = {
      'success': COLORS.green,
      'warning': COLORS.amber,
      'danger': COLORS.red,
      'info': COLORS.blue,
      'default': COLORS.gray,
    };

    const color = colorMap[type] || colorMap.default;

    this.ensureSpace(20);

    this.currentPage.drawText(`[ ${sanitizeForPdf(label)} ]`, {
      x: MARGIN,
      y: this.yPosition,
      size: 11,
      font: this.fonts.bold,
      color: color,
    });

    this.yPosition -= 18;
    return this;
  }

  /**
   * Add a horizontal divider
   */
  addDivider() {
    this.ensureSpace(20);
    this.yPosition -= 8;

    this.currentPage.drawLine({
      start: { x: MARGIN, y: this.yPosition },
      end: { x: PAGE_WIDTH - MARGIN, y: this.yPosition },
      thickness: 0.5,
      color: COLORS.veryLightGray,
    });

    this.yPosition -= 12;
    return this;
  }

  /**
   * Add vertical spacing
   */
  addSpace(height = 10) {
    this.yPosition -= height;
    return this;
  }

  /**
   * Add a colored box with text (for highlights)
   */
  addHighlightBox(title, content, options = {}) {
    const { titleColor = COLORS.amber, fontSize = 10 } = options;

    const contentLines = this.wrapText(content, CONTENT_WIDTH - 20, this.fonts.regular, fontSize);
    const boxHeight = 20 + (contentLines.length * (fontSize + 4)) + 10;

    this.ensureSpace(boxHeight + 10);

    // Draw title
    this.currentPage.drawText(sanitizeForPdf(title), {
      x: MARGIN,
      y: this.yPosition,
      size: 11,
      font: this.fonts.bold,
      color: titleColor,
    });
    this.yPosition -= 16;

    // Draw content
    for (const line of contentLines) {
      this.currentPage.drawText(line, {
        x: MARGIN + 10,
        y: this.yPosition,
        size: fontSize,
        font: this.fonts.regular,
        color: COLORS.darkGray,
      });
      this.yPosition -= fontSize + 4;
    }

    this.yPosition -= 8;
    return this;
  }

  /**
   * Add a two-column layout
   */
  addTwoColumns(leftContent, rightContent, options = {}) {
    const { fontSize = 10 } = options;
    const colWidth = (CONTENT_WIDTH - 20) / 2;
    const startY = this.yPosition;

    // Calculate heights
    const leftLines = leftContent ? this.wrapText(leftContent, colWidth - 10, this.fonts.regular, fontSize) : [];
    const rightLines = rightContent ? this.wrapText(rightContent, colWidth - 10, this.fonts.regular, fontSize) : [];
    const maxLines = Math.max(leftLines.length, rightLines.length);

    this.ensureSpace(maxLines * (fontSize + 4) + 10);

    // Draw left column
    let y = this.yPosition;
    for (const line of leftLines) {
      this.currentPage.drawText(line, {
        x: MARGIN,
        y: y,
        size: fontSize,
        font: this.fonts.regular,
        color: COLORS.darkGray,
      });
      y -= fontSize + 4;
    }

    // Draw right column
    y = this.yPosition;
    for (const line of rightLines) {
      this.currentPage.drawText(line, {
        x: MARGIN + colWidth + 20,
        y: y,
        size: fontSize,
        font: this.fonts.regular,
        color: COLORS.darkGray,
      });
      y -= fontSize + 4;
    }

    this.yPosition -= maxLines * (fontSize + 4) + 10;
    return this;
  }

  /**
   * Wrap text to fit within a given width
   */
  wrapText(text, maxWidth, font, fontSize) {
    if (!text) return [];

    const sanitized = sanitizeForPdf(text);
    const allLines = [];

    // Split on newlines first, then wrap each paragraph
    for (const paragraph of sanitized.split('\n')) {
      const trimmed = paragraph.trim();
      if (!trimmed) {
        allLines.push('');
        continue;
      }

      const words = trimmed.split(' ');
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = font.widthOfTextAtSize(testLine, fontSize);

        if (testWidth > maxWidth && currentLine) {
          allLines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        allLines.push(currentLine);
      }
    }

    return allLines;
  }

  /**
   * Build and return the PDF bytes
   */
  async build() {
    return await this.doc.save();
  }
}

/**
 * Download PDF bytes as a file
 */
export function downloadPdf(pdfBytes, filename) {
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Get badge type based on recommendation
 */
export function getRecommendationBadgeType(recommendation) {
  if (!recommendation) return 'default';
  const lower = recommendation.toLowerCase();
  if (lower.includes('strong recommend')) return 'success';
  if (lower.includes('recommend') && !lower.includes('not')) return 'info';
  if (lower.includes('borderline')) return 'warning';
  if (lower.includes('not recommended')) return 'danger';
  return 'default';
}

/**
 * Get badge type based on rating
 */
export function getRatingBadgeType(rating) {
  if (!rating) return 'default';
  const lower = rating.toLowerCase();
  if (lower === 'strong') return 'success';
  if (lower === 'moderate') return 'warning';
  if (lower === 'weak') return 'danger';
  return 'default';
}
