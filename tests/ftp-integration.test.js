/**
 * FTP Integration Tests
 *
 * Tests all FTP operations against live test servers.
 * Run with: node tests/ftp-integration.test.js
 */

const API_BASE = 'https://portofcall.ross.gg/api/ftp';

// Test server credentials
const FTP_CONFIG = {
  host: 'ftp.dlptest.com',
  port: 21,
  username: 'dlpuser@dlptest.com',
  password: 'SzMf7rTE4pCrf9dV286GuNe4N',
};

let testsPassed = 0;
let testsFailed = 0;

/**
 * Test helper function
 */
async function test(name, fn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    await fn();
    console.log('✅ PASS');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}`);
    testsFailed++;
  }
}

/**
 * Test 1: Connect to FTP server
 */
async function testConnect() {
  const response = await fetch(`${API_BASE}/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(FTP_CONFIG),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Connect failed: ${data.error}`);
  }

  if (!data.success) {
    throw new Error('Connect returned success: false');
  }

  if (!data.currentDirectory) {
    throw new Error('No currentDirectory in response');
  }
}

/**
 * Test 2: List directory contents
 */
async function testList() {
  const response = await fetch(`${API_BASE}/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...FTP_CONFIG,
      path: '/',
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`List failed: ${data.error}`);
  }

  if (!data.success) {
    throw new Error('List returned success: false');
  }

  if (!Array.isArray(data.files)) {
    throw new Error('No files array in response');
  }
}

/**
 * Test 3: Upload file
 */
async function testUpload() {
  const testContent = `Test file uploaded at ${new Date().toISOString()}`;
  const blob = new Blob([testContent], { type: 'text/plain' });

  const formData = new FormData();
  formData.append('host', FTP_CONFIG.host);
  formData.append('port', FTP_CONFIG.port.toString());
  formData.append('username', FTP_CONFIG.username);
  formData.append('password', FTP_CONFIG.password);
  formData.append('remotePath', '/portofcall-test-upload.txt');
  formData.append('file', blob, 'test.txt');

  const response = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Upload failed: ${data.error}`);
  }

  if (!data.success) {
    throw new Error('Upload returned success: false');
  }

  if (data.size !== testContent.length) {
    throw new Error(`Size mismatch: expected ${testContent.length}, got ${data.size}`);
  }
}

/**
 * Test 4: Download file
 */
async function testDownload() {
  const response = await fetch(`${API_BASE}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...FTP_CONFIG,
      remotePath: '/portofcall-test-upload.txt',
    }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(`Download failed: ${data.error}`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType !== 'application/octet-stream') {
    throw new Error(`Wrong content type: ${contentType}`);
  }

  const content = await response.text();
  if (!content.includes('Test file uploaded at')) {
    throw new Error('Downloaded content does not match uploaded content');
  }
}

/**
 * Test 5: Rename file
 */
async function testRename() {
  const response = await fetch(`${API_BASE}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...FTP_CONFIG,
      fromPath: '/portofcall-test-upload.txt',
      toPath: '/portofcall-test-renamed.txt',
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Rename failed: ${data.error}`);
  }

  if (!data.success) {
    throw new Error('Rename returned success: false');
  }
}

/**
 * Test 6: Delete file
 */
async function testDelete() {
  const response = await fetch(`${API_BASE}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...FTP_CONFIG,
      remotePath: '/portofcall-test-renamed.txt',
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Delete failed: ${data.error}`);
  }

  if (!data.success) {
    throw new Error('Delete returned success: false');
  }
}

/**
 * Test 7: Create directory
 */
async function testMkdir() {
  const timestamp = Date.now();
  const response = await fetch(`${API_BASE}/mkdir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...FTP_CONFIG,
      dirPath: `/portofcall-test-dir-${timestamp}`,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Mkdir failed: ${data.error}`);
  }

  if (!data.success) {
    throw new Error('Mkdir returned success: false');
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('\n🧪 FTP Integration Tests');
  console.log('========================\n');
  console.log(`Testing against: ${FTP_CONFIG.host}\n`);

  await test('FTP Connect', testConnect);
  await test('FTP List Directory', testList);
  await test('FTP Upload File', testUpload);
  await test('FTP Download File', testDownload);
  await test('FTP Rename File', testRename);
  await test('FTP Delete File', testDelete);
  await test('FTP Create Directory', testMkdir);

  console.log('\n========================');
  console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);

  if (testsFailed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('\n❌ Test suite failed:', error);
  process.exit(1);
});
