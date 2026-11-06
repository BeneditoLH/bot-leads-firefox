browser.action.onClicked.addListener(async () => {
  const url = browser.runtime.getURL('panel.html');
  const tabs = await browser.tabs.query({url});
  if (tabs.length) {
    await browser.tabs.update(tabs[0].id, {active:true});
    await browser.windows.update(tabs[0].windowId, {focused:true});
  } else await browser.tabs.create({url});
});
