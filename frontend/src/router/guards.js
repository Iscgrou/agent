window.guards = {
    async requireAdmin(to, from, next) {
        try {
            const user = await window.authService.getCurrentUser();
            if (user && user.role === 'admin') {
                next();
            } else {
                next('/dashboard');
            }
        } catch (error) {
            console.error('Error checking admin status:', error);
            next('/dashboard');
        }
    },

    async requireAuth(to, from, next) {
        const isAuthenticated = await window.authService.isAuthenticated();
        if (isAuthenticated) {
            next();
        } else {
            next('/login');
        }
    },

    async requireGuest(to, from, next) {
        const isAuthenticated = await window.authService.isAuthenticated();
        if (!isAuthenticated) {
            next();
        } else {
            next('/dashboard');
        }
    }
};
