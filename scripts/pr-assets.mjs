// Adds screenshots to the repo's orphan pr-assets branch under <card>/ (never main).
// Usage: node pr-assets.mjs <repo dir> <card> <file>...
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const [repo, card, ...files] = process.argv.slice(2);
const SHA = /^[0-9a-f]{40}$/;
const git = (args, input) =>
    execFileSync('git', ['-C', repo, ...args], { input, encoding: 'utf8' }).trim();
const sha = (value, what) => {
    if (!SHA.test(value)) {
        throw new Error(`bad sha for ${what}: ${JSON.stringify(value)}`);
    }
    return value;
};

// A repo's first screenshots start the orphan branch; otherwise build on top of it.
const exists = git(['ls-remote', 'origin', 'refs/heads/pr-assets']) !== '';
let parent = null;
let rootTree = null;
if (exists) {
    git(['fetch', '-q', 'origin', 'pr-assets']);
    parent = sha(git(['rev-parse', 'origin/pr-assets']), 'origin/pr-assets');
    rootTree = sha(git(['rev-parse', `${parent}^{tree}`]), 'parent tree');
}

const blobs = files.map((file) => ({
    name: path.basename(file),
    blob: sha(git(['hash-object', '-w', file]), file),
}));
const cardTree = sha(
    git(['mktree'], blobs.map((b) => `100644 blob ${b.blob}\t${b.name}`).join('\n') + '\n'),
    'card tree',
);

const entries = rootTree
    ? git(['ls-tree', rootTree])
          .split('\n')
          .filter((line) => line && line.split('\t')[1] !== card)
    : [];
entries.push(`040000 tree ${cardTree}\t${card}`);
const newRoot = sha(git(['mktree'], entries.join('\n') + '\n'), 'root tree');
const commit = sha(
    git(['commit-tree', newRoot, ...(parent ? ['-p', parent] : []), '-m', `Screenshots for ${card}`]),
    'commit',
);

if (parent) {
    execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', parent, commit]);
}
git(['push', 'origin', `${commit}:refs/heads/pr-assets`]);
console.log(`pushed ${commit}`);
