const fs = require('fs');
const path = require('path');
const U = require('../mocha.test.util');

// root-level before & after hooks

before(async () => {
  // Remove previous screenshots
  const screenshotDirectory = path.resolve(__dirname, 'screenshots');
  const screenshotFiles = await fs.promises.readdir(screenshotDirectory);
  const unlinkPromises = screenshotFiles
    .filter((file) => file.endsWith('.png'))
    .map((file) => fs.promises.unlink(path.join(screenshotDirectory, file)));
  await Promise.all(unlinkPromises);
  await U.initResources();
});

after(async () => {
  await U.closeResources();
});
