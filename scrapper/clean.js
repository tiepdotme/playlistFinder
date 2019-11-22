const axios = require('axios');
const chalk = require('chalk');
const {default: PQueue} = require('p-queue');
const process = require('process');
const blessed = require('blessed');
const fs = require('fs');

const {getAllPlaylists, connectToDB} = require('./lib/playlists');

const screen = blessed.screen();
const statusBar = blessed.box({
  bottom: 0,
  left: 0,
  height: 1,
  width: '100%',
  style: {
    fg: 'white',
    bg: 'blue',
  },
});
const out = blessed.box({
  top: 0,
  left: 0,
  height: '100%-1',
  width: '100%',
});

screen.append(statusBar);
screen.append(out);

const updateStatus = content => {
  statusBar.setContent(content);
  screen.render();
};

const log = content => {
  out.insertLine(0, content);
  screen.render();
};

async function cleanupDeadPlaylists() {
  updateStatus(`Reading playlists...`);

  const db = await connectToDB();
  const genPlaylists = getAllPlaylists(db, 100000);
  const stats = {};
  const dead = [];
  const unknown = [];
  const temp = [];
  const queue = new PQueue({concurrency: 100});

  let count = 0;
  queue.on('active', () => {
    updateStatus(
      `Checking playlists - Working on #${chalk.bold(
        ++count,
      )}.  Size: ${chalk.bold(queue.size)}  Pending: ${
        queue.pending
      } - Alive: ${chalk.green.bold(
        stats['200'] || 0,
      )} | Dead: ${chalk.red.bold(stats[404] || 0)}`,
    );
  });

  for await (let pls of genPlaylists) {
    temp.push(pls.map(pl => ({name: pl.name, href: pl.href, id: pl.id})));
  }
  const playlists = temp.flat();

  log(`Found ${playlists.length} playlists`);

  playlists.forEach(pl => {
    queue.add(async () => {
      const {status} = await axios.head(pl.href, {
        validateStatus: () => true,
      });

      if (stats[status]) stats[status] += 1;
      else stats[status] = 1;

      if (status === 200) log(`${pl.name} - ${chalk.green('alive')}`);
      else if (status === 404) {
        log(`${pl.name} - ${chalk.red('dead')}`);
        dead.push(pl.id);
      } else {
        log(`${pl.name} - unknown`);
        unknown.push(pl.id);
      }
    });
  });

  await queue.onIdle();

  fs.writeFileSync('out.json', {
    dead,
    unknown,
  });

  process.exit(0);
}

cleanupDeadPlaylists();
