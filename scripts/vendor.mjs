import {cp,mkdir} from 'node:fs/promises';
await mkdir('vendor',{recursive:true});
for(const [src,dst] of [['legacy/build/pdf.mjs','pdf.mjs'],['legacy/build/pdf.worker.mjs','pdf.worker.mjs'],['LICENSE','PDFJS-LICENSE.txt'],['cmaps','cmaps'],['standard_fonts','standard_fonts']]) {
 await cp('node_modules/pdfjs-dist/'+src,'vendor/'+dst,{recursive:true});
}
console.log('Vendored PDF.js runtime, fonts, CMaps, and licenses.');
