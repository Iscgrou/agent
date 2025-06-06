// Initialize Vue app when all dependencies are loaded
function initVueApp() {
    // Get Vue and Vue Router from window (CDN)
    const { createApp } = Vue;
    const { createRouter, createWebHashHistory } = VueRouter;

    // Create router
    const router = createRouter({
        history: createWebHashHistory(),
        routes: [
            { 
                path: '/', 
                redirect: '/dashboard',
            },
            {
                path: '/login',
                component: window.Login,
                beforeEnter: window.guards.requireGuest
            },
            {
                path: '/register',
                component: window.Register,
                beforeEnter: window.guards.requireGuest
            },
            {
                path: '/dashboard',
                component: window.Dashboard,
                beforeEnter: window.guards.requireAuth
            },
            {
                path: '/projects',
                component: window.ProjectList,
                beforeEnter: window.guards.requireAuth
            },
            {
                path: '/settings',
                component: window.Settings,
                beforeEnter: window.guards.requireAuth,
                children: [
                    {
                        path: 'api',
                        component: window.ApiSettings,
                        beforeEnter: window.guards.requireAdmin
                    }
                ]
            }
        ]
    });

    // Create and mount the app
    const app = createApp(window.App);

    // Use router
    app.use(router);

    // Use store
    app.use(window.store);

    // Global error handler
    app.config.errorHandler = (err, vm, info) => {
        console.error('Global error:', err);
        // TODO: Implement error tracking service
    };

    // Add custom directives
    app.directive('click-outside', {
        mounted(el, binding) {
            el.clickOutsideEvent = event => {
                if (!(el === event.target || el.contains(event.target))) {
                    binding.value(event);
                }
            };
            document.addEventListener('click', el.clickOutsideEvent);
        },
        unmounted(el) {
            document.removeEventListener('click', el.clickOutsideEvent);
        }
    });

    // Add global components
    app.component('loading-spinner', {
        template: `
            <div class="flex justify-center items-center">
                <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-secondary"></div>
            </div>
        `
    });

    app.component('error-alert', {
        props: ['message'],
        template: `
            <div class="bg-error/10 border border-error/20 text-error px-4 py-3 rounded relative" role="alert">
                <span class="block sm:inline">{{ message }}</span>
            </div>
        `
    });

    app.component('success-alert', {
        props: ['message'],
        template: `
            <div class="bg-success/10 border border-success/20 text-success px-4 py-3 rounded relative" role="alert">
                <span class="block sm:inline">{{ message }}</span>
            </div>
        `
    });

    // Mount app
    app.mount('#app');
}

// Wait for dependencies to load
window.addEventListener('load', () => {
    const checkDependencies = setInterval(() => {
        if (window.Vue && window.VueRouter && window.Vuex && window.store && window.App) {
            clearInterval(checkDependencies);
            initVueApp();
        }
    }, 100);
});
