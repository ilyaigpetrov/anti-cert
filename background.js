// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
console.log('Extension started.');

var attachedTabs = {};
var version = '1.0';

chrome.debugger.onEvent.addListener(onEvent);
chrome.debugger.onDetach.addListener(onDetach);

chrome.action.onClicked.addListener(function(tab) {
  var tabId = tab.id;
  var debuggeeId = {tabId:tabId};

  if (attachedTabs[tabId] == 'pausing')
    return;

  if (!attachedTabs[tabId])
    chrome.debugger.attach(debuggeeId, version, onAttach.bind(null, debuggeeId));
  else if (attachedTabs[tabId])
    chrome.debugger.detach(debuggeeId, onDetach.bind(null, debuggeeId));
});

async function onAttach(debuggeeId) {
  if (chrome.runtime.lastError) {
    alert(chrome.runtime.lastError.message);
    return;
  }

  var tabId = debuggeeId.tabId;
  chrome.action.setIcon({tabId: tabId, path:'debuggerPausing.png'});
  chrome.action.setTitle({tabId: tabId, title:'Pausing JavaScript'});
  attachedTabs[tabId] = 'pausing';

  await chrome.debugger.sendCommand(
    debuggeeId,
    'Debugger.enable',
  );

  await chrome.debugger.sendCommand(
    debuggeeId, 'Network.enable', {},
  );
  await chrome.debugger.sendCommand(
    debuggeeId,
    'Network.setRequestInterception',
    {
      patterns: [{
        urlPattern: '*',
        resourceType: 'XHR',
      }],
    },
  );
}

const requestIdToUrl = {};
const tabQueue = [];

async function onEvent(debuggeeId, method, params) {
  // console.log(method, 'PARAMS:', params);
  const tabIdFromEvent = debuggeeId.tabId;
  switch (method) {
    case 'Network.requestIntercepted': {
        console.log('INTERCEPTED:', params);
        requestIdToUrl[params.requestId] = new URL(params.request.url);
        await chrome.debugger.sendCommand(
          debuggeeId,
          'Network.continueInterceptedRequest',
          { interceptionId: params.interceptionId });
        console.log('passed to continue routine. Trying to get the cert.')
        const url = new URL(params.request.url);
        const res = await chrome.debugger.sendCommand(
          debuggeeId,
          'Network.getCertificate',
          { origin: url.origin },
        );
        console.log('CERT:', res);
      }
      break;
    case 'Network.loadingFailed': {
        attachedTabs[tabIdFromEvent] = 'paused';
        chrome.action.setIcon({ tabId: tabIdFromEvent, path: 'debuggerContinue.png' });
        chrome.action.setTitle({ tabId: tabIdFromEvent, title: 'Resume JavaScript' });

        console.log('NETWORK FAILED:', params);
        if (params.errorText === 'net::ERR_CERT_AUTHORITY_INVALID') {
          console.log('CERT PROBLEM');
          const url = requestIdToUrl[params.requestId];
          tabQueue.push(await chrome.tabs.create({ url: url.origin, active: true }));
          await chrome.debugger.sendCommand(
            debuggeeId,
            'Debugger.pause',
          );
          chrome.tabs.onRemoved.addListener(
            async (tabId) => {
              if (tabId === createdTabId) {
                tabQueue.shift();
                if (tabQueue.length <= 0) {
                  await chrome.debugger.sendCommand(
                    debuggeeId,
                    'Debugger.resume',
                  );
                  await chrome.debugger.sendCommand(
                    debuggeeId,
                    'Network.replayXHR',
                    { requestId: params.requestId },
                  );                    

                }
              }
            }
          )
            
            

        }
      }
      break;
    case 'Network.requestWillBeSent': {
        console.log('REQ WILL:', params);
      }
      break;
  }
}

function onDetach(debuggeeId) {
  var tabId = debuggeeId.tabId;
  delete attachedTabs[tabId];
  chrome.action.setIcon({tabId:tabId, path:'debuggerPause.png'});
  chrome.action.setTitle({tabId:tabId, title:'Pause JavaScript'});
}
