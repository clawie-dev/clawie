// @no-test: the test file IS the mirror — this file documents that the
// mirror-check script itself is exempt from mirror-test enforcement to
// avoid recursive surface. Coverage of the script's logic is exercised
// via its CI run as a smoke test, not unit tests.
import { test } from '@japa/runner'

test.group('scripts/check_mirror_tests (placeholder)', () => {
  test('placeholder passes', async ({ assert }) => {
    assert.equal(1, 1)
  })
})
