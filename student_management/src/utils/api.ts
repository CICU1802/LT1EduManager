import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000',
});

api.interceptors.request.use((config) => {
  const user = localStorage.getItem('edu_user');
  const password = localStorage.getItem('edu_password');
  
  if (user && password) {
    config.headers['x-api-user'] = user;
    config.headers['x-api-key'] = password;
  } else if (password) {
    // Backwards compatibility for old single-password sessions
    config.headers['x-api-key'] = password;
  }
  return config;
});

api.interceptors.response.use(
  response => response,
  error => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('edu_password');
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

export default api;
