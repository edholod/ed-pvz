// Recreate only the renderer tab. The persistent context retains authenticated
// cookies and origin storage; no credentials are exported or copied elsewhere.
export async function renewWBPage(page){
 const context=page.context();
 await page.close();
 const fresh=await context.newPage();
 fresh.setDefaultTimeout(10000);
 return fresh;
}
