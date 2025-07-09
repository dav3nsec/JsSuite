const express = require('express');
const { chromium } = require('playwright');

const app = express();
const port = 5000;

app.use(express.json());
app.use(express.static('public'));

let browser, page, client;
let keywords = new Set();
let knownScripts = [];
let activeBreakpoints = new Map();
let interceptOn = true;
let history = [];

/**
 * Escape special regex characters
 */
function escapeRegexSpecialChars(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Robust keyword detection with multiple patterns - optimized for minified code
 */
function detectKeywordInLine(line, keyword) {
  const normalizedLine = line.toLowerCase();
  const normalizedKeyword = keyword.toLowerCase();
  
  // Pattern 1: Exact substring match (most reliable for complex patterns)
  if (normalizedLine.includes(normalizedKeyword)) {
    const startIndex = normalizedLine.indexOf(normalizedKeyword);
    const actualMatch = line.substring(startIndex, startIndex + keyword.length);
    return { found: true, pattern: 'exact_substring', match: actualMatch };
  }
  
  // Pattern 2: Case-insensitive exact match with word boundaries (for simple keywords)
  if (!keyword.includes('(') && !keyword.includes('.') && !keyword.includes(',')) {
    const exactWordRegex = new RegExp(`\\b${escapeRegexSpecialChars(normalizedKeyword)}\\b`, 'i');
    const match = line.match(exactWordRegex);
    if (match) {
      return { found: true, pattern: 'exact_word', match: match[0] };
    }
  }
  
  // Pattern 3: Flexible regex for complex patterns (like function calls)
  try {
    const escapedKeyword = escapeRegexSpecialChars(keyword);
    const flexibleRegex = new RegExp(escapedKeyword, 'i');
    const match = line.match(flexibleRegex);
    if (match) {
      return { found: true, pattern: 'regex_match', match: match[0] };
    }
  } catch (e) {
    // If regex fails, fall back to simple inclusion
  }
  
  return { found: false, pattern: null, match: null };
}

/**
 * Detect if JavaScript code is minified
 */
function isMinified(code) {
  if (!code || code.length < 100) return false;
  
  const lines = code.split('\n');
  const avgLineLength = code.length / lines.length;
  
  const hasVeryLongLines = lines.some(line => line.length > 500);
  const hasHighAvgLineLength = avgLineLength > 200;
  const hasLowLineCount = lines.length < 10 && code.length > 1000;
  
  return hasVeryLongLines || hasHighAvgLineLength || hasLowLineCount;
}

/**
 * Find keyword positions in a single minified line
 */
function findKeywordPositionsInMinifiedLine(line, keyword) {
  const positions = [];
  
  // Try multiple variations of the keyword
  const variations = [
    keyword, // exact match
    keyword.replace(/\s+/g, ''), // without spaces
    keyword.replace(/\s+/g, ' '), // normalized spaces
  ];
  
  for (const variation of variations) {
    const lowerLine = line.toLowerCase();
    const lowerVariation = variation.toLowerCase();
    let startIndex = 0;
    
    while (true) {
      const index = lowerLine.indexOf(lowerVariation, startIndex);
      if (index === -1) break;
      
      // Check if this position already exists (avoid duplicates)
      const existingPos = positions.find(p => Math.abs(p.column - index) < 5);
      if (!existingPos) {
        positions.push({
          column: index,
          match: line.substring(index, index + variation.length),
          pattern: 'substring_match',
          variation: variation
        });
        console.log(`[COLUMN] Found "${variation}" at column ${index}`);
      }
      
      startIndex = index + 1;
    }
  }
  
  return positions;
}

async function launchBrowser() {
  try {
    if (browser) {
      console.log('🔵 Browser already launched');
    }
    
    console.log('Launching browser...');
    browser = await chromium.launch({ 
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });
    
    console.log('[INFO] Creating new page...');
    page = await browser.newPage();
    
    // Set a reasonable viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    
    console.log('Creating CDP session...');
    client = await page.context().newCDPSession(page);

    console.log('[INFO] Enabling debugger...');
    await client.send('Debugger.enable');
    
    // Add error handling for page events
    page.on('error', (error) => {
      console.error('[ERROR] Page error:', error);
    });
    
    page.on('pageerror', (error) => {
      console.error('[ERROR] Page script error:', error);
    });
    
    page.on('console', (msg) => {
      console.log('[INFO]  Console:', msg.text());
    });

    client.on('Debugger.scriptParsed', async (script) => {
      try {
        if (knownScripts.find(s => s.scriptId === script.scriptId)) return;
        knownScripts.push(script);
        console.log(`[INFO] Script parsed: ${script.url || '<inline>'}`);

        if (!script.url || !script.url.endsWith('.js')) return;
        await setBreakpointsForScript(script);
      } catch (error) {
        console.error('[ERROR] Error in scriptParsed handler:', error);
      }
    });

    client.on('Debugger.paused', async (params) => {
      try {
        const callFrames = params.callFrames;
        if (!callFrames || callFrames.length === 0) {
          await client.send('Debugger.resume');
          return;
        }

        const topFrame = callFrames[0];
        const { lineNumber, columnNumber, scriptId } = topFrame.location;
        
        const result = await client.send('Debugger.getScriptSource', { scriptId });
        const scriptSource = result.scriptSource;
        const lines = scriptSource.split('\n');
        const lineText = lines[lineNumber] || '';

        let matchedKeyword = null;
        let matchDetails = null;
        
        for (const kw of keywords) {
          const detection = detectKeywordInLine(lineText, kw);
          if (detection.found) {
            matchedKeyword = kw;
            matchDetails = detection;
            break;
          }
        }

        if (matchedKeyword) {
          const scriptMeta = knownScripts.find(s => s.scriptId === scriptId);
          const scriptUrl = (scriptMeta && scriptMeta.url) ? scriptMeta.url : '<inline script>';

          let args = {};
          try {
            const scope = topFrame.scopeChain.find(s => s.type === 'local' || s.type === 'closure');
            if (scope) {
              const objectId = scope.object.objectId;
              if (objectId) {
                const props = await client.send('Runtime.getProperties', {
                  objectId,
                  ownProperties: true,
                });

                for (const prop of props.result) {
                  if (prop.value) {
                    let valStr = '';
                    try {
                      valStr = prop.value.value !== undefined ? JSON.stringify(prop.value.value) : prop.value.description || '';
                      if (valStr.length > 200) valStr = valStr.slice(0, 200) + '...';
                    } catch {
                      valStr = '[unserializable]';
                    }
                    args[prop.name] = valStr;
                  }
                }
              }
            }
          } catch (e) {
            console.error('[ERROR] Error getting scope variables:', e);
          }

          history.push({
            timestamp: new Date().toLocaleString(),
            scriptUrl,
            lineNumber: lineNumber + 1,
            columnNumber,
            keyword: matchedKeyword,
            code: lineText.trim(),
            args,
            isMinified: isMinified(scriptSource),
            matchPattern: matchDetails.pattern,
            matchText: matchDetails.match,
          });
          
          console.log(`[INFO] Keyword "${matchedKeyword}" detected (${matchDetails.pattern}): ${matchDetails.match}`);
        }

        if (!interceptOn) {
          await client.send('Debugger.resume');
        }
      } catch (e) {
        console.error('[ERROR] Error in pause handler:', e);
        try { 
          await client.send('Debugger.resume'); 
        } catch (resumeError) {
          console.error('[ERROR] Error resuming debugger:', resumeError);
        }
      }
    });
    
    console.log('✅ Browser launched successfully');
  } catch (error) {
    console.error('[ERROR] Failed to launch browser:', error);
    throw error;
  }
}

/**
 * Optimized breakpoint setting - works directly with minified scripts
 */
async function setBreakpointsForScript(script) {
  if (!script.url || !script.url.endsWith('.js')) return;

  try {
    const { scriptSource } = await client.send('Debugger.getScriptSource', {
      scriptId: script.scriptId,
    });

    const lines = scriptSource.split('\n');
    let breakpointsSet = 0;
    const keywordMatches = new Map();
    const isScriptMinified = isMinified(scriptSource);
    
    console.log(`[INFO] Checking script ${script.url} (${isScriptMinified ? 'minified' : 'regular'}) for keywords: ${Array.from(keywords).join(', ')}`);
    
    // Handle single-line minified scripts (most common case)
    if (isScriptMinified && lines.length === 1) {
      const singleLine = lines[0];
      const keywordPositions = new Map();
      
      // Debug: Check for similar patterns
      for (const kw of keywords) {
        console.log(`[INFO] Looking for keyword: "${kw}"`);
        
        // Check for variations of the pattern
        const variations = [
          kw, // exact match
          kw.replace(/\s+/g, ''), // without spaces
          kw.replace(/\s+/g, ' '), // normalized spaces
        ];
        
        // Also check for individual components
        if (kw.includes('apply')) {
          variations.push('apply');
        }
        if (kw.match(/[A-Z]\.apply/)) {
          variations.push('.apply');
        }
        
        let foundAnyVariation = false;
        for (const variation of variations) {
          if (singleLine.includes(variation)) {
            console.log(`✅ Found variation "${variation}" in script`);
            foundAnyVariation = true;
            break;
          }
        }
        
        if (!foundAnyVariation) {
          // Sample the script to see what's there
          const sampleStart = singleLine.substring(0, 200);
          const sampleEnd = singleLine.substring(singleLine.length - 200);
          console.log(`❌ Keyword "${kw}" not found. Script sample start: ${sampleStart}...`);
          console.log(`❌ Script sample end: ...${sampleEnd}`);
          
          // Look for .apply patterns
          const applyMatches = singleLine.match(/\w+\.apply\([^)]*\)/g);
          if (applyMatches) {
            console.log(`🔍 Found .apply patterns: ${applyMatches.slice(0, 5).join(', ')}${applyMatches.length > 5 ? '...' : ''}`);
          }
        }
      }
      
      // Find all keyword positions in the single line
      for (const kw of keywords) {
        console.log(`🔍 Searching for positions of keyword: "${kw}"`);
        const positions = findKeywordPositionsInMinifiedLine(singleLine, kw);
        console.log(`📍 Found ${positions.length} positions for keyword "${kw}"`);
        
        if (positions.length > 0) {
          keywordPositions.set(kw, positions);
          keywordMatches.set(kw, positions.map(pos => ({
            line: 1,
            column: pos.column,
            pattern: pos.pattern,
            match: pos.match,
            code: singleLine.substring(Math.max(0, pos.column - 50), pos.column + 50) + '...'
          })));
          console.log(`✅ Found keyword "${kw}" ${positions.length} times in minified line`);
        }
      }
      
      // Set breakpoints at strategic positions
      const allPositions = [];
      for (const [keyword, positions] of keywordPositions) {
        allPositions.push(...positions.map(pos => ({ ...pos, keyword })));
      }
      
      // Sort by column position and deduplicate nearby positions (within 10 chars)
      allPositions.sort((a, b) => a.column - b.column);
      const uniquePositions = [];
      for (const pos of allPositions) {
        if (uniquePositions.length === 0 || 
            pos.column - uniquePositions[uniquePositions.length - 1].column > 10) {
          uniquePositions.push(pos);
        }
      }
      
      // Set breakpoints
      for (const pos of uniquePositions) {
        const key = `${script.scriptId}:0:${pos.column}`;
        if (!activeBreakpoints.has(key)) {
          try {
            const result = await client.send('Debugger.setBreakpoint', {
              location: { scriptId: script.scriptId, lineNumber: 0, columnNumber: pos.column },
            });
            activeBreakpoints.set(key, result.breakpointId);
            breakpointsSet++;
            console.log(`✅ Breakpoint set at column ${pos.column} for keyword "${pos.keyword}"`);
          } catch (err) {
            console.log(`⚠️  Failed to set breakpoint at column ${pos.column}: ${err.message}`);
          }
        }
      }
    } else {
      // Handle multi-line scripts (regular approach)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let lineHasBreakpoint = false;
        
        for (const kw of keywords) {
          const detection = detectKeywordInLine(line, kw);
          if (detection.found) {
            if (!keywordMatches.has(kw)) {
              keywordMatches.set(kw, []);
            }
            keywordMatches.get(kw).push({
              line: i + 1,
              pattern: detection.pattern,
              match: detection.match,
              code: line.trim().substring(0, 100) + (line.trim().length > 100 ? '...' : '')
            });
            
            const key = `${script.scriptId}:${i}`;
            
            if (!lineHasBreakpoint && !activeBreakpoints.has(key)) {
              try {
                const result = await client.send('Debugger.setBreakpoint', {
                  location: { scriptId: script.scriptId, lineNumber: i, columnNumber: 0 },
                });
                activeBreakpoints.set(key, result.breakpointId);
                lineHasBreakpoint = true;
                breakpointsSet++;
                console.log(`✅ Breakpoint set at line ${i + 1} for keyword "${kw}"`);
              } catch (err) {
                console.log(`⚠️  Failed to set breakpoint at line ${i + 1}: ${err.message}`);
              }
            }
          }
        }
      }
    }
    
    // Log matches found
    for (const [keyword, matches] of keywordMatches) {
      console.log(`[INFO] Keyword "${keyword}" found ${matches.length} times in ${script.url}`);
    }
    
    console.log(`[INFO] Script ${script.url}: ${breakpointsSet} breakpoints set (${isScriptMinified ? 'minified' : 'regular'})`);
  } catch (e) {
    console.error('[ERROR] Failed to get script source:', e.message);
  }
}

async function applyKeywordToExistingScripts(keyword) {
  console.log(`[INFO] Applying keyword "${keyword}" to ${knownScripts.length} existing scripts...`);
  
  for (const script of knownScripts) {
    if (!script.url || !script.url.endsWith('.js')) continue;
    try {
      await setBreakpointsForScript(script);
    } catch (error) {
      console.error(`[ERROR] Error applying keyword to script ${script.url}:`, error);
    }
  }
}

// ROUTES
app.post('/open', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).send('URL required');
    
    console.log(`🌐 Opening URL: ${url}`);
    await launchBrowser();

    // Clear previous state
    knownScripts = [];
    activeBreakpoints.clear();
    

    // Set longer timeout and add better error handling
    console.log('🔄 Navigating to page...');
    await page.goto(url, { 
      timeout: 90000, // 90 seconds
      waitUntil: 'domcontentloaded' // Don't wait for all resources
    });
    
    console.log('✅ Page loaded successfully');
    res.send(`✅ Page loaded: ${url}`);
  } catch (error) {
    console.error('[ERROR] Error opening page:', error);
    res.status(500).send(`❌ Error loading page: ${error.message}`);
  }
});

app.post('/add-keyword', async (req, res) => {
  try {
    const { keyword } = req.body;
    if (!keyword) return res.status(400).send('keyword required');
    
    keywords.add(keyword);
    console.log(`➕ Added keyword: ${keyword}`);
    
    if (knownScripts.length > 0) {
      await applyKeywordToExistingScripts(keyword);
    }
    
    res.send(`✅ Keyword added: ${keyword}`);
  } catch (error) {
    console.error('[ERROR] Error adding keyword:', error);
    res.status(500).send(`❌ Error adding keyword: ${error.message}`);
  }
});

app.post('/remove-keyword', async (req, res) => {
  const { keyword } = req.body;
  if (!keyword) return res.status(400).send('keyword required');
  keywords.delete(keyword);
  console.log(`➖ Removed keyword: ${keyword}`);
  res.send(`✅ Keyword removed: ${keyword}`);
});

app.post('/intercept', async (req, res) => {
  const { mode } = req.body;
  if (!mode || !['on', 'off'].includes(mode)) {
    return res.status(400).send('mode must be "on" or "off"');
  }

  interceptOn = mode === 'on';
  console.log(`[INFO] Intercept mode: ${mode.toUpperCase()}`);
  res.send(`[INFO] Intercept mode ${mode.toUpperCase()}`);
});

app.get('/keywords', (req, res) => {
  res.json(Array.from(keywords));
});

app.get('/history', (req, res) => {
  res.json(history);
});

app.post('/clear-history', (req, res) => {
  history.length = 0;
  console.log('🧹 History cleared');
  res.sendStatus(200);
});

app.get('/status', (req, res) => {
  res.json({
    browserLaunched: !!browser,
    pageLoaded: !!page,
    clientConnected: !!client,
    scriptsLoaded: knownScripts.length,
    activeBreakpoints: activeBreakpoints.size,
    keywords: Array.from(keywords),
    interceptOn,
    historyEntries: history.length
  });
});

app.get('/script-source/:scriptId', async (req, res) => {
  const { scriptId } = req.params;
  
  try {
    if (!client) {
      return res.status(500).json({ error: 'Client not connected' });
    }
    
    const { scriptSource } = await client.send('Debugger.getScriptSource', { scriptId });
    res.json({ 
      source: scriptSource, 
      isMinified: isMinified(scriptSource)
    });
  } catch (error) {
    console.error('[ERROR] Error getting script source:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper endpoint to search for patterns in all scripts
app.post('/search-pattern', async (req, res) => {
  try {
    const { pattern } = req.body;
    if (!pattern) return res.status(400).send('pattern required');
    
    if (!client) {
      return res.status(500).json({ error: 'Client not connected' });
    }
    
    const results = [];
    
    for (const script of knownScripts) {
      if (!script.url || !script.url.endsWith('.js')) continue;
      
      try {
        const { scriptSource } = await client.send('Debugger.getScriptSource', {
          scriptId: script.scriptId,
        });
        
        const matches = [];
        const lines = scriptSource.split('\n');
        
        if (isMinified(scriptSource) && lines.length === 1) {
          // For minified single-line scripts
          const line = lines[0];
          let index = 0;
          while (true) {
            const foundIndex = line.toLowerCase().indexOf(pattern.toLowerCase(), index);
            if (foundIndex === -1) break;
            
            matches.push({
              line: 1,
              column: foundIndex,
              context: line.substring(Math.max(0, foundIndex - 50), foundIndex + pattern.length + 50)
            });
            index = foundIndex + 1;
          }
        } else {
          // For regular scripts
          lines.forEach((line, lineIndex) => {
            if (line.toLowerCase().includes(pattern.toLowerCase())) {
              matches.push({
                line: lineIndex + 1,
                column: line.toLowerCase().indexOf(pattern.toLowerCase()),
                context: line.trim()
              });
            }
          });
        }
        
        if (matches.length > 0) {
          results.push({
            scriptUrl: script.url,
            scriptId: script.scriptId,
            isMinified: isMinified(scriptSource),
            matches: matches
          });
        }
      } catch (error) {
        results.push({
          scriptUrl: script.url,
          scriptId: script.scriptId,
          error: error.message
        });
      }
    }
    
    res.json({
      pattern,
      totalScripts: knownScripts.length,
      scriptsWithMatches: results.length,
      results
    });
  } catch (error) {
    console.error('[ERROR] Error searching pattern:', error);
    res.status(500).json({ error: error.message });
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down...');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down...');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

app.listen(port, () => {
  console.log(`🟢 JsSuite v1.0 running on http://localhost:${port}`);
  console.log(`Available endpoints:`);
  console.log(`   POST /open - Load a website`);
  console.log(`   POST /add-keyword - Add keyword to monitor`);
  console.log(`   POST /remove-keyword - Remove keyword`);
  console.log(`   POST /intercept - Toggle intercept mode`);
  console.log(`   GET /keywords - List keywords`);
  console.log(`   GET /history - View detection history`);
  console.log(`   GET /status - Check system status`);
  console.log(`   POST /search-pattern - Search for patterns in scripts`);
});