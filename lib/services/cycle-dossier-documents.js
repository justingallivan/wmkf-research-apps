/** Server-side Cycle Dossier document renderers. */
import { createHash } from 'crypto';
import { TextEncoder as NodeTextEncoder } from 'util';
import { PDFDocument, StandardFonts, PDFName, PDFString, rgb } from 'pdf-lib';

const SECTIONS = [
  ['Project at a glance', 'projectAtAGlance'],
  ['Why it matters', 'whyItMatters'],
  ['The field around it', 'fieldAroundIt'],
  ['Background for an outside-field scientist', 'backgroundForOutsideField'],
];

const str = (value) => String(value ?? '').trim();
const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const unsupportedForPdf = value => str(value);

// Local renderer: the shared report builder treats a paragraph as indivisible.
// Dossier sections can span pages, so wrap titles/URLs and paginate every line.
// Standard Symbol provides Greek/math glyphs alongside the text fonts without
// adding a remotely loaded font or sending private content to a converter.
class DossierPdfBuilder {
  async init() {
    this.doc = await PDFDocument.create();
    this.fonts = { regular: await this.doc.embedFont(StandardFonts.Helvetica),
      bold: await this.doc.embedFont(StandardFonts.HelveticaBold), symbol: await this.doc.embedFont(StandardFonts.Symbol) };
    this.characters = Object.fromEntries(Object.entries(this.fonts).map(([key,font])=>[key,new Set(font.getCharacterSet())]));
    this.unsupported = new Set(); this.addPage(); return this;
  }
  addPage() { this.currentPage = this.doc.addPage([612,792]); this.yPosition=738; return this; }
  ensureSpace(height) { if(this.yPosition-height<54)this.addPage(); }
  pieces(value,bold) {
    const result=[]; const preferred=bold?'bold':'regular';
    for(const char of String(value).replace(/\t/g, '    ')) {
      const code=char.codePointAt(0);
      // Standard Symbol's Delta mapping renders blank in common PDF viewers.
      // Spell it out visibly instead of silently losing scientific notation.
      if (code === 0x394 || code === 0x2206) {
        this.unsupported.add(`U+${code.toString(16).toUpperCase()} = Delta`);
        for (const c of '[Delta]') result.push({ char: c, font: preferred });
        continue;
      }
      const font=this.characters[preferred].has(code)?preferred:this.characters.symbol.has(code)?'symbol':null;
      if(font) result.push({char,font});
      else {
        this.unsupported.add(`U+${code.toString(16).toUpperCase()}`);
        for(const c of `[U+${code.toString(16).toUpperCase()}]`)result.push({char:c,font:preferred});
      }
    }
    return result;
  }
  addParagraph(value,{fontSize=11,bold=false,link=null,gap=8}={}) {
    for(const paragraph of String(value??'').split('\n')) {
      let line=[];let width=0;
      const flush=()=>{
        this.ensureSpace(fontSize+5);let x=54;
        // Coalesce runs to keep text selection/search and PDF size sensible.
        const runs=[];
        for(const piece of line) {
          const previous=runs[runs.length-1];
          if(previous?.font===piece.font)previous.text+=piece.char;else runs.push({font:piece.font,text:piece.char});
        }
        for(const run of runs) {
          this.currentPage.drawText(run.text,{x,y:this.yPosition,size:fontSize,font:this.fonts[run.font],color:link?rgb(0.12,0.27,0.45):rgb(0.12,0.12,0.12)});
          x+=this.fonts[run.font].widthOfTextAtSize(run.text,fontSize);
        }
        if(link && /^https?:\/\//i.test(link) && x>54) {
          const annotation=this.doc.context.register(this.doc.context.obj({Type:'Annot',Subtype:'Link',Rect:[54,this.yPosition-2,x,this.yPosition+fontSize],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(link)}}));
          const key=PDFName.of('Annots');const annotations=this.currentPage.node.lookup(key);
          if(annotations)annotations.push(annotation);else this.currentPage.node.set(key,this.doc.context.obj([annotation]));
        }
        this.yPosition-=fontSize+5;line=[];width=0;
      };
      for(const word of paragraph.split(/(\s+)/)) {
        const pieces=this.pieces(word,bold);
        const wordWidth=pieces.reduce((sum,p)=>sum+this.fonts[p.font].widthOfTextAtSize(p.char,fontSize),0);
        if(width && width+wordWidth>504)flush();
        for(const piece of pieces) {
          const charWidth=this.fonts[piece.font].widthOfTextAtSize(piece.char,fontSize);
          if(width+charWidth>504)flush();
          if(!line.length && /\s/.test(piece.char))continue;
          line.push(piece);width+=charWidth;
        }
      }
      if(line.length)flush();else this.yPosition-=5;
    }
    this.yPosition-=gap;return this;
  }
  addTitle(title,subtitle) { this.addParagraph(title,{fontSize:20,bold:true});if(subtitle)this.addParagraph(subtitle,{fontSize:10});return this; }
  addSection(title,level=1) { this.ensureSpace(70);this.yPosition-=10;return this.addParagraph(title,{fontSize:level===1?14:12,bold:true,gap:5}); }
  addMetadata(key,value) { return this.addParagraph(`${key}: ${value}`,{fontSize:9,gap:3}); }
  addBadge(value) { return this.addParagraph(value,{bold:true,fontSize:10}); }
  async build() {return this.doc.save();}
}

function validateManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.entries) || !manifest.entries.length) throw new Error('Cycle dossier manifest has no entries');
  for (const item of manifest.entries) {
    if (!item?.entry || !item.entry.references || !item.requestId) throw new Error('Cycle dossier manifest contains an invalid entry');
  }
  return manifest;
}

function entryTitle(item) {
  return str(item.requestNumber) ? `Request ${str(item.requestNumber)}${str(item.title) ? ` — ${str(item.title)}` : ''}` : (str(item.title) || 'Cycle dossier entry');
}

function referenceLines(item) {
  return (item.entry.references || []).map((ref, index) => `[${index + 1}] ${str(ref.title) || ref.sourceId} — ${str(ref.url)} (retrieved ${str(ref.retrievedAt)})`);
}

function gapLine(gap) {
  if (typeof gap === 'string') return gap;
  if (!gap || typeof gap !== 'object') return String(gap || '');
  return [gap.source, gap.query, gap.reason, gap.message].filter(Boolean).join(': ');
}

function orderedEntries(manifest) {
  const entries = [...manifest.entries];
  if (Array.isArray(manifest.groups) && manifest.groups.length) {
    const byId = new Map(entries.map((entry) => [entry.requestId, entry]));
    const grouped = [];
    for (const group of manifest.groups) for (const id of group.requestIds || []) if (byId.has(id)) grouped.push(byId.get(id));
    for (const entry of entries) if (!grouped.includes(entry)) grouped.push(entry);
    return grouped;
  }
  return entries.sort((a, b) => str(a.programDirector).localeCompare(str(b.programDirector)) || entryTitle(a).localeCompare(entryTitle(b)));
}

function addEntryPdf(builder, item, { combined = false } = {}) {
  builder.addSection(unsupportedForPdf(entryTitle(item)));
  if (str(item.institution)) builder.addMetadata('Institution', unsupportedForPdf(item.institution));
  if (str(item.pi)) builder.addMetadata('PI', unsupportedForPdf(item.pi));
  if (str(item.programDirector)) builder.addMetadata('Program director', unsupportedForPdf(item.programDirector));
  if (item.provenance?.generatedAt) builder.addMetadata('Generated', unsupportedForPdf(item.provenance.generatedAt));
  if (item.revision != null) builder.addMetadata('Revision', unsupportedForPdf(item.revision));
  if (item.research?.coverage) builder.addMetadata('Research coverage', unsupportedForPdf(item.research.coverage));
  if (item.research?.partial) builder.addBadge('PARTIAL RESEARCH COVERAGE', 'warning');
  for (const [heading, key] of SECTIONS) builder.addSection(unsupportedForPdf(heading), 2).addParagraph(unsupportedForPdf(item.entry[key]));
  builder.addSection('References', 2);
  referenceLines(item).forEach((line,index)=>builder.addParagraph(line,{fontSize:9,link:item.entry.references[index].url}));
  if (!combined) builder.addParagraph('Private Cycle Dossier briefing. Proposal claims, external evidence, and interpretation are presented with their source provenance.', { fontSize: 9 });
}

async function renderPdf(items, { title, partial = false, gaps = [] } = {}) {
  const builder = await new DossierPdfBuilder().init();
  builder.addTitle(unsupportedForPdf(title), 'Cycle Dossier · generated from frozen source snapshots');
  if (partial) builder.addBadge('PARTIAL COVERAGE', 'warning').addParagraph(unsupportedForPdf(gaps.map(gapLine).filter(Boolean).join('; ') || 'Some external sources were unavailable; coverage is disclosed in each entry.'));
  let lastPd = null;
  items.forEach((item) => {
    if (items.length > 1 && str(item.programDirector) !== lastPd) {
      if (lastPd) builder.addPage();
      lastPd = str(item.programDirector);
      if (lastPd) builder.addSection(unsupportedForPdf(`Program Director: ${lastPd}`));
    }
    addEntryPdf(builder, item, { combined: items.length > 1 });
  });
  if(builder.unsupported.size)builder.addParagraph(`Some characters are identified by Unicode code point (${[...builder.unsupported].join(', ')}). The Word edition preserves the original characters.`,{fontSize:8});
  const pages = builder.doc.getPages();
  pages.forEach((page, index) => page.drawText(`Page ${index + 1} of ${pages.length}`, {
    x: page.getWidth() - 100, y: 24, size: 8, font: builder.fonts.regular,
  }));
  return builder.build();
}

async function renderDocx(items, { title, partial = false, gaps = [] } = {}) {
  if (!globalThis.TextEncoder) globalThis.TextEncoder = NodeTextEncoder;
  const { Document, Footer, HeadingLevel, PageBreak, PageNumber, Packer, Paragraph, TextRun, ExternalHyperlink } = await import('docx');
  const body = (value, options = {}) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: str(value), font: 'Calibri', size: 22, ...options })] });
  const heading = (value, level = HeadingLevel.HEADING_1) => new Paragraph({ heading: level, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: str(value), font: 'Calibri', size: level === HeadingLevel.HEADING_1 ? 28 : 24, bold: true })] });
  const children = [heading(title, HeadingLevel.TITLE), body('Cycle Dossier · generated from frozen source snapshots', { italics: true, color: '666666' })];
  if (partial) {
    children.push(body('PARTIAL COVERAGE', { bold: true, color: '996600' }));
    children.push(body(gaps.map(gapLine).filter(Boolean).join('; ') || 'Some external sources were unavailable; coverage is disclosed in each entry.'));
  }
  let lastPd = null;
  for (const item of items) {
    if (items.length > 1 && str(item.programDirector) !== lastPd) {
      if (lastPd) children.push(new Paragraph({ children: [new PageBreak()] }));
      lastPd = str(item.programDirector);
      if (lastPd) children.push(heading(`Program Director: ${lastPd}`));
    }
    children.push(heading(entryTitle(item)));
    for (const [label, value] of [['Institution', item.institution], ['PI', item.pi], ['Program director', item.programDirector]]) if (str(value)) children.push(body(`${label}: ${str(value)}`));
    if (item.provenance?.generatedAt) children.push(body(`Generated: ${str(item.provenance.generatedAt)}`, { size: 18, color: '666666' }));
    if (item.revision != null) children.push(body(`Revision: ${str(item.revision)}`, { size: 18, color: '666666' }));
    if (item.research?.coverage) children.push(body(`Research coverage: ${str(item.research.coverage)}`, { size: 18, color: '666666' }));
    if (item.research?.partial) children.push(body('PARTIAL RESEARCH COVERAGE', { bold: true, color: '996600' }));
    for (const [label, key] of SECTIONS) { children.push(heading(label, HeadingLevel.HEADING_2)); children.push(body(item.entry[key])); }
    children.push(heading('References', HeadingLevel.HEADING_2));
    for (const [index, ref] of (item.entry.references || []).entries()) {
      const label = `[${index + 1}] ${str(ref.title) || ref.sourceId} — ${str(ref.url)} (retrieved ${str(ref.retrievedAt)})`;
      const linked = str(ref.url) ? new ExternalHyperlink({ link: str(ref.url), children: [new TextRun({ text: label, style: 'Hyperlink', font: 'Calibri', size: 20 })] }) : new TextRun({ text: label, font: 'Calibri', size: 20 });
      children.push(new Paragraph({ spacing: { after: 60 }, children: [linked] }));
    }
  }
  const footer = new Footer({ children: [new Paragraph({ alignment: 'center', children: [new TextRun({ text: 'Page ', font: 'Calibri', size: 18 }), new TextRun({ children: [PageNumber.CURRENT], font: 'Calibri', size: 18 })] })] });
  const doc = new Document({ creator: 'W. M. Keck Foundation Request Workbench', title: str(title), sections: [{ footers: { default: footer }, children }] });
  return Packer.toBuffer(doc);
}

export async function renderIndividualDossierDocuments(item) {
  validateManifest({ entries: [item] });
  const [docx, pdf] = await Promise.all([
    renderDocx([item], { title: entryTitle(item) }),
    renderPdf([item], { title: entryTitle(item) }),
  ]);
  return { docx, pdf, docxSha256: hashBytes(docx), pdfSha256: hashBytes(pdf) };
}

export async function renderCombinedDossierDocuments(manifest) {
  validateManifest(manifest);
  const title = manifest.title || 'D26 Cycle Dossier';
  const gaps = Array.isArray(manifest.gaps) ? manifest.gaps : [];
  const entries = orderedEntries(manifest);
  const [docx, pdf] = await Promise.all([
    renderDocx(entries, { title, partial: Boolean(manifest.partial), gaps }),
    renderPdf(entries, { title, partial: Boolean(manifest.partial), gaps }),
  ]);
  return { docx, pdf, docxSha256: hashBytes(docx), pdfSha256: hashBytes(pdf) };
}

export async function renderDossierDocuments(manifest, { includeIndividual = true, includeCombined = true } = {}) {
  validateManifest(manifest);
  const individual = includeIndividual ? await Promise.all(manifest.entries.map(renderIndividualDossierDocuments)) : [];
  const combined = includeCombined ? await renderCombinedDossierDocuments(manifest) : null;
  return { individual, combined, renderedAt: new Date().toISOString(), sourceManifestHash: sha256Manifest(manifest) };
}

function sha256Manifest(manifest) {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}
