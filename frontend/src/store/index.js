// Wait for dependencies to load
function initStore() {
    // Create store instance
    const store = window.Vuex.createStore({
        modules: {
            auth: window.auth,
            settings: window.settings
        },
        // Enable strict mode in development
        strict: false
    });

    // Initialize auth state
    store.dispatch('auth/checkAuth');

    // Export store
    window.store = store;
}

// Wait for dependencies to load
window.addEventListener('load', () => {
    // Check if Vuex and modules are available
    const checkDependencies = setInterval(() => {
        if (window.Vuex && window.auth && window.settings) {
            clearInterval(checkDependencies);
            initStore();
        }
    }, 100);
});
