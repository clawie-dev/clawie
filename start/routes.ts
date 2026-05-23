/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'
import router from '@adonisjs/core/services/router'

router.on('/').renderInertia('home', {}).as('home')

router
  .group(() => {
    router.get('signup', [controllers.NewAccount, 'create'])
    router.post('signup', [controllers.NewAccount, 'store'])

    router.get('login', [controllers.Session, 'create'])
    router.post('login', [controllers.Session, 'store'])
  })
  .use(middleware.guest())

router
  .group(() => {
    router.post('logout', [controllers.Session, 'destroy'])
  })
  .use(middleware.auth())

// ── Phase 1 API surface ───────────────────────────────────────────────────────
router.get('/v1/tasks', [controllers.Tasks, 'index'])
router.post('/v1/tasks', [controllers.Tasks, 'store'])
router.get('/v1/tasks/:id', [controllers.Tasks, 'show'])

// ── Phase 4 approvals ─────────────────────────────────────────────────────────
router.get('/v1/approvals', [controllers.Approvals, 'index'])
router.post('/v1/tasks/:id/approval', [controllers.Approvals, 'decide'])

// ── Phase 6 dashboard ─────────────────────────────────────────────────────────
router.get('/dashboard', [controllers.Dashboard, 'index']).as('dashboard')
