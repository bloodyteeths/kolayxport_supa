document.addEventListener('DOMContentLoaded', () => {
  const inspectBtn = document.getElementById('inspectBtn');
  const logsBtn = document.getElementById('logsBtn');
  const resultsDiv = document.getElementById('results');

  inspectBtn.addEventListener('click', async () => {
    try {
      inspectBtn.textContent = '🔍 Inspecting...';
      inspectBtn.disabled = true;

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab.url || !tab.url.includes('etsy.com')) {
        showError('Please navigate to an Etsy orders page first');
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, { action: 'inspectDOM' });
      
      if (response) {
        displayResults(response);
      } else {
        showError('No response from inspector');
      }

    } catch (error) {
      showError(`Inspection failed: ${error.message}`);
    } finally {
      inspectBtn.textContent = '🔍 Inspect DOM';
      inspectBtn.disabled = false;
    }
  });

  logsBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getInspectorLogs' });
      
      if (response && response.logs) {
        displayLogs(response.logs);
      } else {
        showError('No logs available');
      }
    } catch (error) {
      showError(`Failed to get logs: ${error.message}`);
    }
  });

  function displayResults(inspection) {
    resultsDiv.style.display = 'block';
    resultsDiv.innerHTML = '';

    // Page info
    const pageInfo = document.createElement('div');
    pageInfo.className = 'finding';
    pageInfo.innerHTML = `
      <h4>📄 Page Information</h4>
      <div><strong>URL:</strong> ${inspection.url}</div>
      <div><strong>Title:</strong> ${inspection.title}</div>
      <div><strong>Total Elements:</strong> ${inspection.findings.pageStructure.totalElements}</div>
    `;
    resultsDiv.appendChild(pageInfo);

    // Order data attributes
    if (inspection.findings.orderDataAttributes.length > 0) {
      const orderAttrs = document.createElement('div');
      orderAttrs.className = 'finding';
      orderAttrs.innerHTML = `
        <h4>🎯 Order-Related Attributes (${inspection.findings.orderDataAttributes.length})</h4>
        ${inspection.findings.orderDataAttributes.map(attr => 
          `<div><strong>${attr.tag}</strong> [${attr.attribute}="${attr.value}"] → ${attr.selector}</div>`
        ).join('')}
      `;
      resultsDiv.appendChild(orderAttrs);
    }

    // Order classes
    if (inspection.findings.orderClasses.length > 0) {
      const orderClasses = document.createElement('div');
      orderClasses.className = 'finding';
      orderClasses.innerHTML = `
        <h4>🏷️ Order-Related Classes (${inspection.findings.orderClasses.length})</h4>
        ${inspection.findings.orderClasses.map(cls => 
          `<div><strong>${cls.tag}</strong> .${cls.classes} → "${cls.textContent}"</div>`
        ).join('')}
      `;
      resultsDiv.appendChild(orderClasses);
    }

    // Table rows
    if (inspection.findings.tableRows.length > 0) {
      const tableRows = document.createElement('div');
      tableRows.className = 'finding';
      tableRows.innerHTML = `
        <h4>📊 Table Rows (${inspection.findings.tableRows.length})</h4>
        ${inspection.findings.tableRows.map(row => 
          `<div><strong>Row ${row.index}:</strong> ${row.cellCount} cells, ${row.hasAddress ? '📍 has address' : ''} "${row.textPreview}"</div>`
        ).join('')}
      `;
      resultsDiv.appendChild(tableRows);
    }

    // Potential order divs
    if (inspection.findings.potentialOrderDivs.length > 0) {
      const orderDivs = document.createElement('div');
      orderDivs.className = 'finding';
      orderDivs.innerHTML = `
        <h4>📦 Potential Order Containers (${inspection.findings.potentialOrderDivs.length})</h4>
        ${inspection.findings.potentialOrderDivs.map(div => 
          `<div><strong>Div:</strong> ${div.hasAddress ? '📍' : ''} ${div.hasPrice ? '💰' : ''} ${div.hasDate ? '📅' : ''} "${div.textPreview}"</div>`
        ).join('')}
      `;
      resultsDiv.appendChild(orderDivs);
    }

    // Addresses
    if (inspection.findings.addresses.length > 0) {
      const addresses = document.createElement('div');
      addresses.className = 'finding';
      addresses.innerHTML = `
        <h4>📍 Address Elements (${inspection.findings.addresses.length})</h4>
        ${inspection.findings.addresses.map(addr => 
          `<div><strong>Address:</strong> "${addr.textContent}" (parent: ${addr.parentTag})</div>`
        ).join('')}
      `;
      resultsDiv.appendChild(addresses);
    }

    // Text patterns
    const patterns = inspection.findings.textPatterns;
    if (patterns.orderNumbers.length > 0 || patterns.prices.length > 0 || patterns.dates.length > 0) {
      const textPatterns = document.createElement('div');
      textPatterns.className = 'finding';
      textPatterns.innerHTML = `
        <h4>🔍 Text Patterns Found</h4>
        <div><strong>Order Numbers:</strong> ${patterns.orderNumbers.join(', ')}</div>
        <div><strong>Prices:</strong> ${patterns.prices.join(', ')}</div>
        <div><strong>Dates:</strong> ${patterns.dates.join(', ')}</div>
      `;
      resultsDiv.appendChild(textPatterns);
    }
  }

  function displayLogs(logs) {
    resultsDiv.style.display = 'block';
    resultsDiv.innerHTML = '<h4>📋 Inspector Logs</h4>';
    
    logs.forEach(log => {
      const logEntry = document.createElement('div');
      logEntry.style.marginBottom = '5px';
      logEntry.innerHTML = `
        <strong>${new Date(log.timestamp).toLocaleTimeString()}</strong> 
        [${log.level.toUpperCase()}] ${log.message}
        ${log.data ? `<pre>${JSON.stringify(log.data, null, 2)}</pre>` : ''}
      `;
      resultsDiv.appendChild(logEntry);
    });
  }

  function showError(message) {
    resultsDiv.style.display = 'block';
    resultsDiv.innerHTML = `<div class="finding" style="border-left-color: #f44336;"><h4>❌ Error</h4><div>${message}</div></div>`;
  }
});