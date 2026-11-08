import {WB_ORIGIN} from './news.mjs';

export async function manualInput(page, action) {
  if (new URL(page.url()).origin !== WB_ORIGIN) throw Error('unexpected_origin');
  if (action.type === 'click') {
    const size=page.viewportSize();
    if (!Number.isFinite(action.x) || !Number.isFinite(action.y) || action.x<0 || action.y<0 || action.x>=size.width || action.y>=size.height) throw Error('invalid_coordinates');
    await page.mouse.click(action.x,action.y);
  } else if (action.type === 'text') {
    if(typeof action.text!=='string' || !action.text.length || action.text.length>100 || /[\r\n\0]/.test(action.text)) throw Error('invalid_text');
    if(action.replace===true){await page.keyboard.press('ControlOrMeta+A');await page.keyboard.press('Backspace')}
    // The person types locally in their browser. No per-key VNC transport is involved.
    await page.keyboard.type(action.text,{delay:35});
  } else if (action.type==='key' && ['Tab','Enter','Backspace','Escape'].includes(action.key)) {
    await page.keyboard.press(action.key);
  } else throw Error('invalid_action');
}
