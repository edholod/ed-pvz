(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const files = {
    JSZip: './vendor/jszip-3.10.1.min.js',
    PDFLib: './vendor/pdf-lib-1.17.1.min.js'
  };

  function library(name) {
    if (window[name]) return Promise.resolve(window[name]);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = files[name];
      script.onload = () => window[name] ? resolve(window[name]) : reject(Error('Не удалось загрузить библиотеку экспорта.'));
      script.onerror = () => { script.remove(); reject(Error('Не удалось загрузить библиотеку экспорта.')); };
      document.head.append(script);
    });
  }

  function textWithLinks(element) {
    return Array.from(element.childNodes, node => {
      if (node.nodeName === 'A') return node.textContent + ' (' + node.href + ')';
      return node.nodeType === 3 ? node.textContent : textWithLinks(node);
    }).join('');
  }

  function noteRows(title, body) {
    const preview = document.createElement('div');
    window.EdPVZNoteFormat.render(body, preview, () => {});
    const rows = title ? [{kind:'title', cells:[title]}] : [];
    for (const child of preview.children) {
      const tag = child.tagName;
      if (child.classList.contains('note-table')) {
        for (const row of child.querySelectorAll('tr')) {
          rows.push({kind: row.parentElement.tagName === 'THEAD' ? 'table-head' : 'table',
            cells: Array.from(row.cells, textWithLinks)});
        }
      } else if (tag === 'UL' || tag === 'OL') {
        Array.from(child.children).forEach((item, index) => {
          const check = item.querySelector('input[type="checkbox"]');
          const prefix = check ? (check.checked ? '☑ ' : '☐ ') : tag === 'OL' ? (child.start + index) + '. ' : '• ';
          rows.push({kind:'list', cells:[prefix + textWithLinks(item)]});
        });
      } else if (tag === 'HR') {
        rows.push({kind:'rule', cells:['────────']});
      } else {
        const kind = /^H[2-4]$/.test(tag) ? 'heading' : tag === 'BLOCKQUOTE' ? 'quote' : tag === 'PRE' ? 'code' : 'text';
        rows.push({kind, cells:[textWithLinks(child)]});
      }
    }
    return rows;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function canvasBlob(canvas, type) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(Error('Не удалось создать изображение.'));
    }, type, .92));
  }

  function wrapText(ctx, text, width) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
      let line = '', lineWidth = 0;
      for (const token of paragraph.match(/\S+\s*|\s+/gu) || []) {
        const tokenWidth = ctx.measureText(token).width;
        if (line && lineWidth + tokenWidth > width) { lines.push(line.trimEnd()); line = ''; lineWidth = 0; }
        if (tokenWidth <= width) { line += token; lineWidth += tokenWidth; continue; }
        for (const character of token) {
          const charWidth = ctx.measureText(character).width;
          if (line && lineWidth + charWidth > width) { lines.push(line.trimEnd()); line = ''; lineWidth = 0; }
          line += character;
          lineWidth += charWidth;
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }

  // Draw the same rows for raster images and PDF, with the option to split oversized rows.
  function* pages(rows) {
    rows = rows.flatMap(row => {
      const chunks = [];
      for (let start = 0; start < row.cells.length; start += 10) {
        chunks.push({...row, cells:row.cells.slice(start, start + 10)});
      }
      return chunks;
    });
    const width = 1120, height = 1480, margin = 55, usable = width - margin * 2;
    function newPage() {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.textBaseline = 'top';
      return {canvas, ctx, y:margin};
    }
    let page = newPage();
    for (const row of rows) {
      const table = row.kind.startsWith('table');
      const large = row.kind === 'title' || row.kind === 'heading';
      const quoted = row.kind === 'quote';
      const font = (table && row.kind === 'table-head' || large ? 'bold ' : '') +
        (row.kind === 'title' ? 40 : large ? 32 : table ? 22 : 25) + 'px ' +
        (row.kind === 'code' ? 'monospace' : 'system-ui, sans-serif');
      const lineHeight = row.kind === 'title' ? 52 : large ? 44 : table ? 30 : 36;
      const cellWidth = usable / row.cells.length;
      const inset = table ? 9 : quoted ? 15 : 0;
      page.ctx.font = font;
      const columns = row.cells.map(cell => wrapText(page.ctx, cell, cellWidth - inset * 2));
      const lines = Math.max(...columns.map(column => column.length));
      let offset = 0;
      const padding = table ? 10 : 8;
      while (offset < lines) {
        let fits = Math.floor((height - margin - page.y - padding * 2) / lineHeight);
        if (fits < 1 || (offset === 0 && lines > fits && lines * lineHeight + padding * 2 <= height - margin * 2)) {
          yield page.canvas;
          page = newPage();
          fits = Math.floor((height - margin * 2 - padding * 2) / lineHeight);
        }
        const count = Math.min(fits, lines - offset);
        const blockHeight = count * lineHeight + padding * 2;
        const {ctx, y} = page;
        ctx.font = font;
        if (row.kind === 'rule') {
          ctx.fillStyle = '#d9caed';
          ctx.fillRect(margin, y + padding, usable, 2);
        } else columns.forEach((column, index) => {
          const x = margin + index * cellWidth;
          if (table) {
            ctx.fillStyle = row.kind === 'table-head' ? '#eee5fa' : '#fff';
            ctx.fillRect(x, y, cellWidth, blockHeight);
            ctx.strokeStyle = '#d9caed';
            ctx.strokeRect(x, y, cellWidth, blockHeight);
          }
          if (quoted) {
            ctx.fillStyle = '#ad92d7';
            ctx.fillRect(x, y, 4, blockHeight);
          }
          ctx.fillStyle = large || quoted ? '#503880' : '#282139';
          column.slice(offset, offset + count).forEach((line, index) => {
            ctx.fillText(line, x + inset, y + padding + index * lineHeight);
          });
        });
        page.y += blockHeight;
        offset += count;
      }
    }
    const cropped = document.createElement('canvas');
    cropped.width = width;
    cropped.height = Math.min(height, page.y + margin);
    cropped.getContext('2d').drawImage(page.canvas, 0, 0);
    yield cropped;
  }

  async function pdf(rows) {
    const {PDFDocument} = await library('PDFLib');
    const doc = await PDFDocument.create();
    for (const canvas of pages(rows)) {
      const image = await doc.embedJpg(await (await canvasBlob(canvas, 'image/jpeg')).arrayBuffer());
      const page = doc.addPage([595, 842]);
      const scale = Math.min(595 / canvas.width, 842 / canvas.height);
      page.drawImage(image, {x:0, y:842 - canvas.height * scale, width:canvas.width * scale, height:canvas.height * scale});
      canvas.width = canvas.height = 1;
    }
    return new Blob([await doc.save()], {type:'application/pdf'});
  }

  async function pictures(rows, format, name) {
    const type = 'image/' + (format === 'jpg' ? 'jpeg' : 'png');
    const result = [];
    for (const canvas of pages(rows)) {
      result.push(await canvasBlob(canvas, type));
      canvas.width = canvas.height = 1;
    }
    if (result.length === 1) return [result[0], name + '.' + format];
    const Zip = await library('JSZip');
    const zip = new Zip();
    result.forEach((blob, index) => zip.file(name + '-' + (index + 1) + '.' + format, blob));
    return [await zip.generateAsync({type:'blob'}), name + '-' + format + '.zip'];
  }

  const xml = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[char]));

  function columnName(index) {
    let name = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      name = String.fromCharCode(65 + (n - 1) % 26) + name;
    }
    return name;
  }

  async function excel(rows) {
    const Zip = await library('JSZip');
    const zip = new Zip();
    const sheets = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const rels = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const manifest = 'http://schemas.openxmlformats.org/package/2006/content-types';
    zip.file('[Content_Types].xml', '<Types xmlns="' + manifest + '">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      ['sheet.main', 'worksheet', 'styles'].map((type, index) => '<Override PartName="/xl/' +
        ['workbook.xml','worksheets/sheet1.xml','styles.xml'][index] +
        '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.' + type + '+xml"/>').join('') + '</Types>');
    zip.file('_rels/.rels', '<Relationships xmlns="' + rels + '"><Relationship Id="rId1" Type="' +
      relationships + '/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    zip.file('xl/workbook.xml', '<workbook xmlns="' + sheets + '" xmlns:r="' + relationships +
      '"><sheets><sheet name="Заметка" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="' + rels + '"><Relationship Id="rId1" Type="' +
      relationships + '/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="' +
      relationships + '/styles" Target="styles.xml"/></Relationships>');
    zip.file('xl/styles.xml', '<styleSheet xmlns="' + sheets + '">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');

    let line = 0;
    const contents = rows.flatMap(row => {
      const result = [];
      const style = ['title','heading','table-head'].includes(row.kind) ? 1 : 0;
      for (let start = 0; start < row.cells.length; start += 16384) {
        line++;
        // Inline strings keep note contents literal, including values starting with =.
        const cells = row.cells.slice(start, start + 16384).map((cell, index) =>
          '<c r="' + columnName(index) + line + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
          xml(cell) + '</t></is></c>').join('');
        result.push('<row r="' + line + '">' + cells + '</row>');
      }
      return result;
    }).join('');
    zip.file('xl/worksheets/sheet1.xml', '<worksheet xmlns="' + sheets + '">' +
      '<cols><col min="1" max="1" width="48" customWidth="1"/><col min="2" max="16384" width="24" customWidth="1"/></cols>' +
      '<sheetData>' + contents + '</sheetData></worksheet>');
    return zip.generateAsync({type:'blob', compression:'DEFLATE',
      mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }

  $('export-note').addEventListener('click', async () => {
    const title = $('title').value.trim();
    const body = $('body').value.trim();
    const status = $('export-status');
    if (!title && !body) { status.textContent = 'Напиши заголовок или текст заметки.'; return; }
    const name = (title || 'Заметка').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '').slice(0, 90) || 'Заметка';
    const format = $('export-format').value;
    $('export-note').disabled = true;
    status.textContent = 'Готовим файл…';
    try {
      const rows = noteRows(title, body);
      let blob, filename = name + '.' + format;
      if (format === 'txt') {
        blob = new Blob(['\uFEFF', rows.map(row => row.cells.join('\t').replace(/\n/g, '\r\n')).join('\r\n')],
          {type:'text/plain;charset=utf-8'});
      } else if (format === 'pdf') blob = await pdf(rows);
      else if (format === 'xlsx') blob = await excel(rows);
      else if (format === 'png' || format === 'jpg') [blob, filename] = await pictures(rows, format, name);
      else throw Error('Выбери формат файла.');
      download(blob, filename);
      status.textContent = filename.endsWith('.zip') ? 'Страницы сохранены изображениями в ZIP.' : 'Файл готов к скачиванию.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      $('export-note').disabled = false;
    }
  });
})();
