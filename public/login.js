document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const errorDiv = document.getElementById('errorMsg');
  errorDiv.textContent = '';

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    // Validar estado HTTP
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`HTTP ${response.status}:`, errorText);
      throw new Error(`Error del servidor (${response.status})`);
    }

    // Validar Content-Type
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const html = await response.text();
      console.error('Respuesta no JSON:', html.substring(0, 200));
      throw new Error('El servidor no devolvió un formato JSON válido');
    }

    const result = await response.json();

    if (result.success) {
      localStorage.setItem('token', result.token);
      localStorage.setItem('rol', result.rol);
      localStorage.setItem('propietarioId', result.propietario_id);
      localStorage.setItem('usuarioId', result.usuario_id);

      if (result.rol === 'master') {
        window.location.href = '/master.html';
      } else if (result.rol === 'propietario') {
        window.location.href = `/propietario.html?propietarioId=${result.propietario_id}&usuarioId=${result.usuario_id}`;
      }
    } else {
      errorDiv.textContent = result.message || 'Usuario o contraseña incorrectos';
    }
  } catch (err) {
    console.error('Error en login:', err);
    errorDiv.textContent = 'Error al conectar con el servidor. Intente más tarde.';
  }
});