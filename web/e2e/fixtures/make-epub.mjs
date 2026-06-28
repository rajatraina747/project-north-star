// Generates a minimal but valid EPUB used by the reader e2e test. Run once with
// `node e2e/fixtures/make-epub.mjs`; the committed sample.epub is the output.
// Uses fflate (already a web dependency) so no extra tooling is required.
import { zipSync, strToU8 } from 'fflate';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const para = (n) =>
  `<p>Paragraph ${n}. ` +
  'The quick brown fox jumps over the lazy dog, again and again, '.repeat(8) +
  '</p>';

const chapter = (title, count) =>
  `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h1>${title}</h1>${Array.from({ length: count }, (_, i) => para(i + 1)).join('')}</body></html>`;

const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:northstar-e2e-sample</dc:identifier>
    <dc:title>North Star E2E Sample</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="chapter3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="c3"/>
  </spine>
</package>`;

const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>
<body><nav epub:type="toc" id="toc"><ol>
  <li><a href="chapter1.xhtml">Chapter One</a></li>
  <li><a href="chapter2.xhtml">Chapter Two</a></li>
  <li><a href="chapter3.xhtml">Chapter Three</a></li>
</ol></nav></body></html>`;

const tocNcx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:northstar-e2e-sample"/></head>
  <docTitle><text>North Star E2E Sample</text></docTitle>
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>Chapter One</text></navLabel><content src="chapter1.xhtml"/></navPoint>
    <navPoint id="n2" playOrder="2"><navLabel><text>Chapter Two</text></navLabel><content src="chapter2.xhtml"/></navPoint>
    <navPoint id="n3" playOrder="3"><navLabel><text>Chapter Three</text></navLabel><content src="chapter3.xhtml"/></navPoint>
  </navMap>
</ncx>`;

const zipped = zipSync(
  {
    // mimetype MUST be first and stored uncompressed per the EPUB spec.
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(containerXml),
    'OEBPS/content.opf': strToU8(contentOpf),
    'OEBPS/nav.xhtml': strToU8(navXhtml),
    'OEBPS/toc.ncx': strToU8(tocNcx),
    'OEBPS/chapter1.xhtml': strToU8(chapter('Chapter One', 30)),
    'OEBPS/chapter2.xhtml': strToU8(chapter('Chapter Two', 30)),
    'OEBPS/chapter3.xhtml': strToU8(chapter('Chapter Three', 30)),
  },
  { level: 6 }
);

const out = join(here, 'sample.epub');
writeFileSync(out, zipped);
console.log(`wrote ${out} (${zipped.length} bytes)`);
