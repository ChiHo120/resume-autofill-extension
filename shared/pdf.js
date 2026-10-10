import {getDocument, GlobalWorkerOptions} from '../vendor/pdf.mjs';
GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.mjs', import.meta.url).href;
export async function extractPdfText(file, onProgress = () => {}) {
  if (file.size > 15 * 1024 * 1024) throw new Error('PDF 不能超过 15 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({data:bytes, isEvalSupported:false, useSystemFonts:true,
    cMapUrl:new URL('../vendor/cmaps/',import.meta.url).href,cMapPacked:true,
    standardFontDataUrl:new URL('../vendor/standard_fonts/',import.meta.url).href});
  let doc;
  try {
    doc = await task.promise;
    if (doc.numPages > 30) throw new Error('简历 PDF 不能超过 30 页');
    const pages = []; const emptyPages = []; let length = 0;
    for (let n=1; n<=doc.numPages; n++) {
      onProgress(n,doc.numPages);
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const text = content.items.filter(item => typeof item.str === 'string').map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
      if (!text) emptyPages.push(n);
      length += text.length;
      if (length > 80000) throw new Error('PDF 文字超过 8 万字符，请使用更精简的简历');
      pages.push(text); page.cleanup();
    }
    const text = pages.join('\n\n');
    if (!text.trim()) throw new Error('未提取到文字：该 PDF 可能是扫描图片。请先做 OCR 或使用可选择文字的 PDF');
    return {text,pages:doc.numPages,emptyPages};
  } catch(error) {
    if (error.name === 'PasswordException') throw new Error('PDF 已加密，请先解除密码后导入');
    if (error.name === 'InvalidPDFException') throw new Error('文件不是有效 PDF，或已损坏');
    throw error;
  } finally { await task.destroy(); }
}
