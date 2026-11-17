// Work around Windows cross-drive Next.js entry resolution using a copy of installed packages.
// Only the NEW isolated snapshot's dependency junction is replaced, never its target or source.
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, rmdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { appRoot, canonicalPath } from './lib.mjs';

export async function attachUiDependencies(snapshotApp) {
  const base=path.join(process.env.LOCALAPPDATA,'Temp','enztronic-office-uiux-20261108');
  const app=canonicalPath(snapshotApp);
  if(!app.toLowerCase().startsWith(base.toLowerCase()+path.sep)||path.basename(app)!=='app')throw new Error('Refused UI snapshot dependency target');
  const record=JSON.parse((await readFile(path.join(appRoot,'docs','office','ui-ux-evidence-20261108','dependency-copy.json'),'utf8')).replace(/^\uFEFF/,''));
  const modules=canonicalPath(record.destination);
  if(!modules.toLowerCase().startsWith(base.toLowerCase()+path.sep)||path.basename(modules)!=='node_modules'||!path.basename(path.dirname(modules)).startsWith('dependencies-'))throw new Error('Refused UI dependency copy');
  const digest=file=>readFile(file).then(bytes=>createHash('sha256').update(bytes).digest('hex'));
  for(const entry of record.criticalChecks){
    if(await digest(path.join(modules,entry.path))!==entry.sha256||await digest(path.join(appRoot,'node_modules',entry.path))!==entry.sha256)throw new Error('Installed dependency copy changed');
  }
  const junction=path.join(app,'node_modules');const current=await lstat(junction);
  if(!current.isSymbolicLink()||(await realpath(junction)).toLowerCase()!==(await realpath(path.join(appRoot,'node_modules'))).toLowerCase())throw new Error('Expected new snapshot dependency junction');
  // rmdir has no recursive option: on Windows this removes only the verified junction itself.
  await rmdir(junction);await symlink(modules,junction,'junction');
  if(!(await lstat(junction)).isSymbolicLink()||(await realpath(junction)).toLowerCase()!==modules.toLowerCase())throw new Error('Local dependency junction mismatch');
  return {source:record.source,localCopy:modules,criticalHashesMatched:record.criticalChecks.length,packageInstallPerformed:false};
}
