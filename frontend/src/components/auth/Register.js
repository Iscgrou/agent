window.Register = {
    template: `
        <div class="min-h-screen flex items-center justify-center p-6 bg-deep-space">
            <div class="w-full max-w-md">
                <!-- Register Card -->
                <div class="card-3d bg-primary border border-secondary/20 rounded-2xl shadow-xl p-8">
                    <!-- Header -->
                    <div class="text-center mb-8">
                        <h1 class="text-3xl font-space font-bold text-secondary mb-2">Create Account</h1>
                        <div class="metallic-gold h-1 w-24 mx-auto rounded-full"></div>
                    </div>

                    <!-- Form -->
                    <form @submit.prevent="handleSubmit" class="space-y-6">
                        <!-- Full Name Field -->
                        <div class="space-y-2">
                            <label class="block text-sm font-medium text-accent">
                                Full Name
                            </label>
                            <div class="relative">
                                <input 
                                    type="text" 
                                    v-model="form.fullName"
                                    :class="{ 'border-error': errors.fullName }"
                                    class="w-full px-4 py-3 bg-dark-charcoal border border-secondary/20 rounded-lg 
                                           focus:outline-none focus:border-secondary transition-colors
                                           text-accent placeholder-accent/50"
                                    placeholder="Enter your full name"
                                    required
                                />
                                <i class="fas fa-user absolute right-4 top-1/2 transform -translate-y-1/2 text-secondary/50"></i>
                            </div>
                            <p v-if="errors.fullName" class="text-sm text-error">{{ errors.fullName }}</p>
                        </div>

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
                                    placeholder="Create a password"
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
                            
                            <!-- Password Strength Indicator -->
                            <div v-if="form.password" class="mt-2">
                                <div class="flex space-x-1">
                                    <div v-for="(strength, index) in passwordStrengthBars" 
                                         :key="index"
                                         :class="[
                                             'h-1 flex-1 rounded-full transition-all duration-300',
                                             strength ? 'bg-secondary' : 'bg-secondary/20'
                                         ]">
                                    </div>
                                </div>
                                <p class="text-xs mt-1" :class="passwordStrengthColor">
                                    {{ passwordStrengthText }}
                                </p>
                            </div>
                        </div>

                        <!-- Confirm Password Field -->
                        <div class="space-y-2">
                            <label class="block text-sm font-medium text-accent">
                                Confirm Password
                            </label>
                            <div class="relative">
                                <input 
                                    :type="showPassword ? 'text' : 'password'"
                                    v-model="form.confirmPassword"
                                    :class="{ 'border-error': errors.confirmPassword }"
                                    class="w-full px-4 py-3 bg-dark-charcoal border border-secondary/20 rounded-lg 
                                           focus:outline-none focus:border-secondary transition-colors
                                           text-accent placeholder-accent/50"
                                    placeholder="Confirm your password"
                                    required
                                />
                            </div>
                            <p v-if="errors.confirmPassword" class="text-sm text-error">{{ errors.confirmPassword }}</p>
                        </div>

                        <!-- Terms and Conditions -->
                        <div class="space-y-2">
                            <label class="flex items-center text-accent">
                                <input 
                                    type="checkbox"
                                    v-model="form.acceptTerms"
                                    :class="{ 'border-error': errors.acceptTerms }"
                                    class="form-checkbox h-4 w-4 text-secondary border-secondary/20 rounded 
                                           focus:ring-secondary focus:ring-offset-0 bg-dark-charcoal"
                                />
                                <span class="ml-2 text-sm">
                                    I agree to the 
                                    <a href="#" class="text-secondary hover:text-secondary/80 transition-colors">Terms of Service</a>
                                    and
                                    <a href="#" class="text-secondary hover:text-secondary/80 transition-colors">Privacy Policy</a>
                                </span>
                            </label>
                            <p v-if="errors.acceptTerms" class="text-sm text-error">{{ errors.acceptTerms }}</p>
                        </div>

                        <!-- Submit Button -->
                        <button 
                            type="submit"
                            :disabled="isLoading || !form.acceptTerms"
                            class="w-full py-3 px-4 metallic-gold text-primary font-medium rounded-lg
                                   transform hover:scale-[1.02] transition-transform
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <span v-if="!isLoading">Create Account</span>
                            <loading-spinner v-else />
                        </button>

                        <!-- Error Message -->
                        <error-alert 
                            v-if="errorMessage"
                            :message="errorMessage"
                            class="animate-shake"
                        />
                    </form>

                    <!-- Login Link -->
                    <div class="mt-6 text-center text-accent">
                        Already have an account? 
                        <router-link 
                            to="/login"
                            class="text-secondary hover:text-secondary/80 transition-colors"
                        >
                            Sign in
                        </router-link>
                    </div>
                </div>
            </div>
        </div>
    `,

    setup() {
        const store = window.Vuex.useStore();
        const router = window.VueRouter.useRouter();
        const { ref, reactive, computed } = window.Vue;

        const form = reactive({
            fullName: '',
            email: '',
            password: '',
            confirmPassword: '',
            acceptTerms: false
        });

        const errors = reactive({});
        const errorMessage = ref('');
        const isLoading = ref(false);
        const showPassword = ref(false);

        const passwordStrength = computed(() => {
            let score = 0;
            const password = form.password;

            if (!password) return 0;
            if (password.length >= 8) score++;
            if (password.match(/[A-Z]/)) score++;
            if (password.match(/[a-z]/)) score++;
            if (password.match(/[0-9]/)) score++;
            if (password.match(/[^A-Za-z0-9]/)) score++;

            return score;
        });

        const passwordStrengthBars = computed(() => {
            return Array(5).fill(0).map((_, index) => index < passwordStrength.value);
        });

        const passwordStrengthText = computed(() => {
            const strength = passwordStrength.value;
            if (strength === 0) return 'Very Weak';
            if (strength === 1) return 'Weak';
            if (strength === 2) return 'Fair';
            if (strength === 3) return 'Good';
            if (strength === 4) return 'Strong';
            return 'Very Strong';
        });

        const passwordStrengthColor = computed(() => {
            const strength = passwordStrength.value;
            if (strength <= 1) return 'text-error';
            if (strength <= 2) return 'text-warning';
            return 'text-success';
        });

        const togglePassword = () => {
            showPassword.value = !showPassword.value;
        };

        const validateForm = () => {
            Object.keys(errors).forEach(key => delete errors[key]);

            if (!form.fullName) {
                errors.fullName = 'Full name is required';
            }

            if (!form.email) {
                errors.email = 'Email is required';
            } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
                errors.email = 'Please enter a valid email address';
            }

            if (!form.password) {
                errors.password = 'Password is required';
            } else if (form.password.length < 8) {
                errors.password = 'Password must be at least 8 characters long';
            } else if (passwordStrength.value < 3) {
                errors.password = 'Password is too weak';
            }

            if (form.password !== form.confirmPassword) {
                errors.confirmPassword = 'Passwords do not match';
            }

            if (!form.acceptTerms) {
                errors.acceptTerms = 'You must accept the terms and conditions';
            }

            return Object.keys(errors).length === 0;
        };

        const handleSubmit = async () => {
            if (!validateForm()) return;

            isLoading.value = true;
            errorMessage.value = '';

            try {
                await store.dispatch('auth/register', {
                    fullName: form.fullName,
                    email: form.email,
                    password: form.password
                });

                router.push('/dashboard');
            } catch (error) {
                errorMessage.value = error.response?.data?.message || 'Failed to create account. Please try again.';
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
            passwordStrengthBars,
            passwordStrengthText,
            passwordStrengthColor,
            togglePassword,
            handleSubmit
        };
    }
};
