const { axios } = window;

// Create axios instance with default config
const api = axios.create({
    baseURL: 'http://localhost:3000/api/v1',
    headers: {
        'Content-Type': 'application/json'
    }
});

// Add request interceptor to add auth token
api.interceptors.request.use(
    config => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    error => {
        return Promise.reject(error);
    }
);

// Add response interceptor to handle token refresh
api.interceptors.response.use(
    response => response,
    async error => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;

            try {
                const refreshToken = localStorage.getItem('refreshToken');
                const response = await axios.post('/auth/refresh-token', { refreshToken });
                
                const { accessToken } = response.data;
                localStorage.setItem('token', accessToken);
                
                originalRequest.headers.Authorization = `Bearer ${accessToken}`;
                return api(originalRequest);
            } catch (refreshError) {
                localStorage.removeItem('token');
                localStorage.removeItem('refreshToken');
                window.location.href = '/login';
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);

class AuthService {
    constructor() {
        this.token = localStorage.getItem('token');
        this.refreshToken = localStorage.getItem('refreshToken');
    }

    async login(email, password) {
        try {
            const response = await api.post('/auth/login', { email, password });
            this._setTokens(response.data.accessToken, response.data.refreshToken);
            return response.data.user;
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }

    async register(userData) {
        try {
            const response = await api.post('/auth/register', userData);
            this._setTokens(response.data.accessToken, response.data.refreshToken);
            return response.data.user;
        } catch (error) {
            console.error('Registration error:', error);
            throw error;
        }
    }

    async logout() {
        try {
            if (this.token) {
                await api.post('/auth/logout', { refreshToken: this.refreshToken });
            }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            this._clearTokens();
        }
    }

    async refreshAccessToken() {
        try {
            if (!this.refreshToken) {
                throw new Error('No refresh token available');
            }

            const response = await api.post('/auth/refresh-token', { refreshToken: this.refreshToken });
            this._setTokens(response.data.accessToken, response.data.refreshToken);
            return response.data.accessToken;
        } catch (error) {
            console.error('Token refresh error:', error);
            this._clearTokens();
            throw error;
        }
    }

    async getCurrentUser() {
        try {
            const response = await api.get('/auth/me');
            return response.data.user;
        } catch (error) {
            console.error('Get current user error:', error);
            throw error;
        }
    }

    async isAuthenticated() {
        if (!this.token) return false;
        
        try {
            await this.getCurrentUser();
            return true;
        } catch (error) {
            return false;
        }
    }

    _setTokens(accessToken, refreshToken) {
        this.token = accessToken;
        this.refreshToken = refreshToken;
        localStorage.setItem('token', accessToken);
        localStorage.setItem('refreshToken', refreshToken);
    }

    _clearTokens() {
        this.token = null;
        this.refreshToken = null;
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
    }
}

window.authService = new AuthService();
