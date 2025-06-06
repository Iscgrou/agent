window.Login = {
    template: `
        <div class="min-h-screen flex items-center justify-center p-6 bg-deep-space">
            <div class="w-full max-w-md">
                <!-- Login Card -->
                <div class="card-3d bg-primary border border-secondary/20 rounded-2xl shadow-xl p-8">
                    <!-- Header -->
                    <div class="text-center mb-8">
                        <h1 class="text-3xl font-space font-bold text-secondary mb-2">Welcome Back</h1>
                        <div class="metallic-gold h-1 w-24 mx-auto rounded-full"></div>
                    </div>

                    <!-- Form -->
                    <form @submit.prevent="handleSubmit" class="space-y-6">
                        <!-- Email Field -->
                        <div class="space-y-2">
                            <label class="block text-sm font-medium text-accent">
                                Email Address
                            </label>
                            <div class="relative">
                                <input 
                                    type="email" 
                                    v-model="form.email"
                                    :class="{ 'border-error': errors.email }"
                                    class="w-full px-4 py-3 bg-dark-charcoal border border-secondary/20 rounded-lg 
                                           focus:outline-none focus:border-secondary transition-colors
                                           text-accent placeholder-accent/50"
                                    placeholder="Enter your email"
                                    required
                                />
                                <i class="fas fa-envelope absolute right-4 top-1/2 transform -translate-y-1/2 text-secondary/50"></i>
                            </div>
                            <p v-if="errors.email" class="text-sm text-error">{{ errors.email }}</p>
                        </div>

                        <!-- Password Field -->
                        <div class="space-y-2">
                            <label class="block text-sm font-medium text-accent">
                                Password
                            </label>
                            <div class="relative">
                                <input 
                                    :type="showPassword ? 'text' : 'password'"
                                    v-model="form.password"
                                    :class="{ 'border-error': errors.password }"
                                    class="w-full px-4 py-3 bg-dark-charcoal border border-secondary/20 rounded-lg 
                                           focus:outline-none focus:border-secondary transition-colors
                                           text-accent placeholder-accent/50"
                                    placeholder="Enter your password"
                                    required
                                />
                                <button 
                                    type="button"
                                    @click="togglePassword"
                                    class="absolute right-4 top-1/2 transform -translate-y-1/2 text-secondary/50 hover:text-secondary"
                                >
                                    <i :class="showPassword ? 'fas fa-eye-slash' : 'fas fa-eye'"></i>
                                </button>
                            </div>
                            <p v-if="errors.password" class="text-sm text-error">{{ errors.password }}</p>
                        </div>

                        <!-- Remember Me & Forgot Password -->
                        <div class="flex items-center justify-between text-sm">
                            <label class="flex items-center text-accent">
                                <input 
                                    type="checkbox"
                                    v-model="form.rememberMe"
                                    class="form-checkbox h-4 w-4 text-secondary border-secondary/20 rounded 
                                           focus:ring-secondary focus:ring-offset-0 bg-dark-charcoal"
                                />
                                <span class="ml-2">Remember me</span>
                            </label>
                            <a href="#" class="text-secondary hover:text-secondary/80 transition-colors">
                                Forgot password?
                            </a>
                        </div>

                        <!-- Submit Button -->
                        <button 
                            type="submit"
                            :disabled="isLoading"
                            class="w-full py-3 px-4 metallic-gold text-primary font-medium rounded-lg
                                   transform hover:scale-[1.02] transition-transform
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <span v-if="!isLoading">Sign In</span>
                            <loading-spinner v-else />
                        </button>

                        <!-- Error Message -->
                        <error-alert 
                            v-if="errorMessage"
                            :message="errorMessage"
                            class="animate-shake"
                        />
                    </form>

                    <!-- Register Link -->
                    <div class="mt-6 text-center text-accent">
                        Don't have an account? 
                        <router-link 
                            to="/register"
                            class="text-secondary hover:text-secondary/80 transition-colors"
                        >
                            Create one
                        </router-link>
                    </div>
                </div>

                <!-- Decorative Elements -->
                <div class="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                    <div class="absolute top-0 left-1/4 w-1/2 h-1/2 bg-secondary/5 rounded-full filter blur-3xl"></div>
                    <div class="absolute bottom-0 right-1/4 w-1/2 h-1/2 bg-secondary/5 rounded-full filter blur-3xl"></div>
                </div>
            </div>
        </div>
    `,

    setup() {
        const store = window.Vuex.useStore();
        const router = window.VueRouter.useRouter();
        const { ref, reactive } = window.Vue;

        const form = reactive({
            email: '',
            password: '',
            rememberMe: false
        });

        const errors = reactive({});
        const errorMessage = ref('');
        const isLoading = ref(false);
        const showPassword = ref(false);

        const togglePassword = () => {
            showPassword.value = !showPassword.value;
        };

        const validateForm = () => {
            Object.keys(errors).forEach(key => delete errors[key]);
            
            if (!form.email) {
                errors.email = 'Email is required';
            } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
                errors.email = 'Please enter a valid email address';
            }

            if (!form.password) {
                errors.password = 'Password is required';
            }

            return Object.keys(errors).length === 0;
        };

        const handleSubmit = async () => {
            if (!validateForm()) return;

            isLoading.value = true;
            errorMessage.value = '';

            try {
                await store.dispatch('auth/login', {
                    email: form.email,
                    password: form.password,
                    rememberMe: form.rememberMe
                });

                router.push('/dashboard');
            } catch (error) {
                errorMessage.value = error.response?.data?.message || 'Failed to sign in. Please try again.';
            } finally {
                isLoading.value = false;
            }
        };

        return {
            form,
            errors,
            errorMessage,
            isLoading,
            showPassword,
            togglePassword,
            handleSubmit
        };
    }
};
