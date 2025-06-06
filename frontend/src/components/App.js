window.App = {
    template: `
        <div class="min-h-screen bg-deep-space flex">
            <!-- Sidebar Navigation -->
            <nav v-if="isAuthenticated" 
                 class="w-64 bg-primary border-r border-secondary/20 transition-all duration-300 ease-in-out">
                <div class="h-full flex flex-col">
                    <!-- Logo -->
                    <div class="p-6 border-b border-secondary/20">
                        <h1 class="text-2xl font-space font-bold text-secondary">AI Agent Platform</h1>
                    </div>

                    <!-- Navigation Links -->
                    <div class="flex-1 py-6 space-y-2">
                        <router-link 
                            v-for="item in navItems"
                            :key="item.path"
                            :to="item.path"
                            class="flex items-center px-6 py-3 text-accent hover:bg-secondary/10 transition-colors duration-200"
                            :class="{ 'bg-secondary/10': isCurrentRoute(item.path) }"
                        >
                            <i :class="item.icon" class="w-5 text-secondary"></i>
                            <span class="ml-3">{{ item.name }}</span>
                        </router-link>
                    </div>

                    <!-- User Menu -->
                    <div class="p-6 border-t border-secondary/20">
                        <div class="flex items-center">
                            <div class="w-10 h-10 rounded-full bg-secondary/20 flex items-center justify-center">
                                <i class="fas fa-user text-secondary"></i>
                            </div>
                            <div class="ml-3">
                                <p class="text-accent font-medium">{{ user?.fullName || 'User' }}</p>
                                <button @click="logout" 
                                        class="text-sm text-secondary/80 hover:text-secondary transition-colors">
                                    Logout
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </nav>

            <!-- Main Content -->
            <main class="flex-1 flex flex-col overflow-hidden">
                <!-- Top Bar -->
                <header v-if="isAuthenticated" 
                        class="h-16 bg-primary border-b border-secondary/20 flex items-center justify-between px-6">
                    <!-- Breadcrumb -->
                    <div class="flex items-center space-x-2 text-accent/60">
                        <span v-for="(crumb, index) in breadcrumbs" 
                              :key="index"
                              class="flex items-center">
                            <span :class="{ 'text-secondary': index === breadcrumbs.length - 1 }">
                                {{ crumb }}
                            </span>
                            <i v-if="index < breadcrumbs.length - 1" 
                               class="fas fa-chevron-right text-xs mx-2 text-accent/40"></i>
                        </span>
                    </div>

                    <!-- Actions -->
                    <div class="flex items-center space-x-4">
                        <button class="text-accent hover:text-secondary transition-colors">
                            <i class="fas fa-bell"></i>
                        </button>
                        <button class="text-accent hover:text-secondary transition-colors">
                            <i class="fas fa-cog"></i>
                        </button>
                    </div>
                </header>

                <!-- Page Content -->
                <div class="flex-1 overflow-auto bg-deep-space">
                    <router-view v-slot="{ Component }">
                        <transition name="fade" mode="out-in">
                            <component :is="Component" />
                        </transition>
                    </router-view>
                </div>
            </main>

            <!-- Global Notifications -->
            <div class="fixed bottom-4 right-4 space-y-2">
                <transition-group name="notification">
                    <div v-for="notification in notifications"
                         :key="notification.id"
                         :class="{
                             'bg-success/10 border-success/20': notification.type === 'success',
                             'bg-error/10 border-error/20': notification.type === 'error'
                         }"
                         class="p-4 rounded-lg border shadow-lg backdrop-blur-sm animate-slide-up">
                        {{ notification.message }}
                    </div>
                </transition-group>
            </div>
        </div>
    `,

    setup() {
        const store = window.Vuex.useStore();
        const router = window.VueRouter.useRouter();
        const route = window.VueRouter.useRoute();
        const { ref, computed, onMounted } = window.Vue;

        const user = ref(null);
        const notifications = ref([]);
        const navItems = ref([
            { name: 'Dashboard', path: '/dashboard', icon: 'fas fa-chart-line' },
            { name: 'Projects', path: '/projects', icon: 'fas fa-project-diagram' },
            { name: 'Agents', path: '/agents', icon: 'fas fa-robot' },
            { name: 'Analytics', path: '/analytics', icon: 'fas fa-chart-bar' },
            { name: 'Settings', path: '/settings', icon: 'fas fa-cog' }
        ]);

        const isAuthenticated = computed(() => store.state.auth.isAuthenticated);
        const breadcrumbs = computed(() => route.path.split('/').filter(Boolean));

        const isCurrentRoute = (path) => {
            return route.path === path;
        };

        const showNotification = (message, type = 'info') => {
            const id = Date.now();
            notifications.value.push({ id, message, type });
            setTimeout(() => {
                notifications.value = notifications.value.filter(n => n.id !== id);
            }, 5000);
        };

        const logout = async () => {
            try {
                await store.dispatch('auth/logout');
                router.push('/login');
                showNotification('Successfully logged out', 'success');
            } catch (error) {
                showNotification('Failed to logout', 'error');
            }
        };

        const fetchUserProfile = async () => {
            if (isAuthenticated.value) {
                try {
                    const userData = await store.dispatch('auth/fetchUserProfile');
                    user.value = userData;
                } catch (error) {
                    console.error('Failed to fetch user profile:', error);
                }
            }
        };

        onMounted(() => {
            fetchUserProfile();
        });

        return {
            user,
            notifications,
            navItems,
            isAuthenticated,
            breadcrumbs,
            isCurrentRoute,
            logout
        };
    }
};
