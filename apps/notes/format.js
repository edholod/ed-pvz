(() => {
  'use strict';

  function safeLink(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  function inline(parent, text) {
    const tokens = /`([^`]+)`|\[([^\]\n]+)\]\(([^()\s]+)\)|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*/g;
    let end = 0;
    for (const match of text.matchAll(tokens)) {
      parent.append(text.slice(end, match.index));
      const [, code, label, href, bold, strike, italic] = match;
      const url = href && safeLink(href);
      if (href && !url) parent.append(match[0]);
      else {
        const node = document.createElement(code ? 'code' : href ? 'a' : bold ? 'strong' : strike ? 's' : 'em');
        node.textContent = code || label || bold || strike || italic;
        if (url) {
          node.href = url;
          node.target = '_blank';
          node.rel = 'noopener noreferrer';
        }
        parent.append(node);
      }
      end = match.index + match[0].length;
    }
    parent.append(text.slice(end));
  }

  const checklist = /^\s*[-*] \[([ xX])\] (.*)$/;
  const bullet = /^\s*[-*] (.*)$/;
  const numbered = /^\s*\d+\. (.*)$/;
  const separator = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

  function render(text, container, onCheck) {
    const lines = text.split('\n');
    container.replaceChildren();
    function add(tag, content, parent = container) {
      const node = document.createElement(tag);
      if (content !== undefined) inline(node, content);
      parent.append(node);
      return node;
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const heading = /^(#{1,3}) (.+)$/.exec(line);
      if (heading) { add('h' + (heading[1].length + 1), heading[2]); continue; }
      if (/^---+$/.test(line.trim())) { add('hr'); continue; }
      if (line.trim() === '```') {
        const end = lines.findIndex((value, index) => index > i && value.trim() === '```');
        if (end > i) {
          add('pre').textContent = lines.slice(i + 1, end).join('\n');
          i = end;
          continue;
        }
      }
      if (line.includes('|') && (separator.test(lines[i + 1] || '') || /^\|\s*:?-{3,}:?\s*\|$/.test(lines[i + 1] || ''))) {
        const wrap = add('div');
        wrap.className = 'note-table';
        const table = add('table', undefined, wrap);
        const head = add('tr', undefined, add('thead', undefined, table));
        const columns = cells(line);
        for (const value of columns) add('th', value, head).scope = 'col';
        const tableBody = add('tbody', undefined, table);
        i++;
        while (/^\s*\|.*\|\s*$/.test(lines[i + 1] || '')) {
          const row = add('tr', undefined, tableBody);
          const values = cells(lines[++i]);
          columns.forEach((_, index) => add('td', values[index] || '', row));
        }
        continue;
      }
      const pattern = checklist.test(line) ? checklist : bullet.test(line) ? bullet : numbered.test(line) ? numbered : null;
      if (pattern) {
        const list = add(pattern === numbered ? 'ol' : 'ul');
        if (pattern === numbered) list.start = Number(line.match(/\d+/)[0]);
        if (pattern === checklist) list.className = 'checks';
        for (; i < lines.length && pattern.test(lines[i]); i++) {
          if (pattern === bullet && checklist.test(lines[i])) break;
          const match = pattern.exec(lines[i]);
          const item = add('li', undefined, list);
          if (pattern === checklist) {
            const label = add('label', undefined, item);
            const input = add('input', undefined, label);
            const index = i;
            input.type = 'checkbox';
            input.checked = match[1] !== ' ';
            input.onchange = () => onCheck(index, input.checked);
            inline(label, match[2]);
          } else inline(item, match[1]);
        }
        i--;
        continue;
      }
      if (line.startsWith('> ')) {
        const quote = [];
        do { quote.push(lines[i++].slice(2)); } while (lines[i]?.startsWith('> '));
        add('blockquote', quote.join('\n'));
        i--;
      } else add('p', line);
    }
  }

  window.EdPVZNoteFormat = {render, safeLink};
})();
