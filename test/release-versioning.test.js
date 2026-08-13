const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const semver = require('semver');

const root = path.resolve(__dirname, '..');
const release = YAML.parse(fs.readFileSync(path.join(root, 'release.yaml'), 'utf8'));

describe('developer-charts release policy', () => {
  test('declares its independent platform compatibility range', () => {
    expect(semver.valid(release.version)).toBe(release.version);
    expect(Object.keys(release.requires)).toEqual(['platformComponents']);
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

});
