window.Settings = {
    template: `
        <div class="min-h-screen bg-deep-space p-6">
            <div class="max-w-7xl mx-auto">
                <!-- Settings Header -->
                <div class="mb-8">
                    <h1 class="text-2xl font-space font-bold text-secondary mb-2">Settings</h1>
                    <p class="text-accent/80">Manage your platform settings and configurations</p>
                </div>

                <!-- Settings Navigation -->
                <div class="grid grid-cols-12 gap-6">
                    <!-- Sidebar -->
                    <div class="col-span-3">
                        <div class="card-3d bg-primary border border-secondary/20 rounded-2xl p-4">
                            <nav class="space-y-2">
                                <router-link 
                                    v-if="isAdmin"
                                    to="/settings/api"
                                    class="block px-4 py-2 rounded-lg text-accent hover:bg-dark-charcoal/50 transition-colors"
                                    :class="{ 'bg-dark-charcoal text-secondary': isApiRoute }"
                                >
                                    <i class="fas fa-plug mr-2"></i>
                                    API Settings
                                </router-link>
                                <router-link 
                                    to="/settings/profile"
                                    class="block px-4 py-2 rounded-lg text-accent hover:bg-dark-charcoal/50 transition-colors"
                                    :class="{ 'bg-dark-charcoal text-secondary': isProfileRoute }"
                                >
                                    <i class="fas fa-user mr-2"></i>
                                    Profile Settings
                                </router-link>
                                <router-link 
                                    to="/settings/notifications"
                                    class="block px-4 py-2 rounded-lg text-accent hover:bg-dark-charcoal/50 transition-colors"
                                    :class="{ 'bg-dark-charcoal text-secondary': isNotificationsRoute }"
                                >
                                    <i class="fas fa-bell mr-2"></i>
                                    Notifications
                                </router-link>
                            </nav>
                        </div>
                    </div>

                    <!-- Content Area -->
                    <div class="col-span-9">
                        <router-view></router-view>
                    </div>
                </div>
            </div>
        </div>
    `,

    setup() {
        const store = window.Vuex.useStore();
        const route = window.VueRouter.useRoute();
        const { computed } = window.Vue;

        const isAdmin = computed(() => store.state.auth.user?.role === 'admin');
        const isApiRoute = computed(() => route.path === '/settings/api');
        const isProfileRoute = computed(() => route.path === '/settings/profile');
        const isNotificationsRoute = computed(() => route.path === '/settings/notifications');

        return {
            isAdmin,
            isApiRoute,
            isProfileRoute,
            isNotificationsRoute
        };
    }
};
