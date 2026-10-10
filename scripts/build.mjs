import {cp,mkdir,readFile,access} from 'node:fs/promises';
const dest='dist/unpacked';await mkdir(dest,{recursive:true});
const files=['manifest.json','background.js','content.js','panel.html','panel.js','panel.css','options.html','options.js','README.md','resume.example.json','shared','vendor'];
for(const file of files)await cp(file,dest+'/'+file,{recursive:true});
const manifest=JSON.parse(await readFile(dest+'/manifest.json','utf8'));
for(const file of [manifest.background.service_worker,manifest.options_page,manifest.side_panel.default_path,'shared/api.js','shared/pdf.js','vendor/pdf.mjs','vendor/pdf.worker.mjs'])await access(dest+'/'+file);
console.log('Built extension '+manifest.version+' at '+dest);
