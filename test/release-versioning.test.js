const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const semver = require('semver');

const root = path.resolve(__dirname, '..');
const release = YAML.parse(fs.readFileSync(path.join(root, 'release.yaml'), 'utf8'));

describe('developer-charts release policy', () => {
  test('declares its independent platform compatibility range', () => {
    expect(release).toEqual({
      version: '1.0.0',
      requires: {platformComponents: '>=1.0.0 <2.0.0'},
    });
    expect(semver.valid(release.version)).toBe(release.version);
    expect(semver.validRange(release.requires.platformComponents)).not.toBeNull();
  });

  test('keeps repository-owned chart metadata aligned', () => {
    for (const chart of [
      'domain/environment', 'system/environment', 'api/openapi',
      'component/container', 'resource/postgresql',
    ]) {
      const metadata = YAML.parse(fs.readFileSync(
        path.join(root, 'charts', chart, 'Chart.yaml'), 'utf8'));
      expect(metadata.version).toBe(release.version);
      if (metadata.appVersion !== undefined) expect(metadata.appVersion).toBe(release.version);
    }
  });

  test('models patch independence and additive minor requirements as fixtures', () => {
    const patch = {version: '1.0.1', requires: {...release.requires}};
    expect(patch.requires).toEqual(release.requires);
    expect(semver.satisfies('1.0.0', patch.requires.platformComponents)).toBe(true);

    const minor = {
      version: '1.1.0',
      requires: {platformComponents: '>=1.1.0 <2.0.0'},
    };
    expect(semver.satisfies('1.0.9', minor.requires.platformComponents)).toBe(false);
    expect(semver.satisfies('1.1.0', minor.requires.platformComponents)).toBe(true);
  });
});
