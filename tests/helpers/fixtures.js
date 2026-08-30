const TEST_PASSWORD = 'TemporaryPass123!';

const USERS = {
  userA: { email: 'user-a@example.test', password: TEST_PASSWORD },
  userB: { email: 'user-b@example.test', password: TEST_PASSWORD },
  admin: { email: 'admin@example.test', password: TEST_PASSWORD },
};

function product(overrides = {}) {
  return {
    slug: 'regression-product',
    name: 'Regression Product',
    price: 12500,
    category: 'makanan',
    image: {
      src: 'images/regression-product.jpg',
      alt: 'Regression Product',
      width: 640,
      height: 480,
    },
    description: { id: 'Produk pengujian.', en: 'Test product.' },
    ...overrides,
  };
}

async function jsonRequest(client, path, method, body, headers = {}) {
  return client.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function register(client, credentials, extra = {}) {
  return jsonRequest(client, '/api/auth/register', 'POST', { ...credentials, ...extra });
}

async function login(client, credentials) {
  return jsonRequest(client, '/api/auth/login', 'POST', credentials);
}

async function registerAndLogin(client, credentials) {
  const registration = await register(client, credentials);
  if (registration.status !== 201) throw new Error(`Fixture registration failed: ${registration.status}`);
  const loginResponse = await login(client, credentials);
  if (loginResponse.status !== 200) throw new Error(`Fixture login failed: ${loginResponse.status}`);
  return loginResponse;
}

module.exports = { TEST_PASSWORD, USERS, product, jsonRequest, register, login, registerAndLogin };
