import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { loginSchema, changePasswordSchema } from '../utils/validators';

export async function authRoutes(fastify: FastifyInstance) {
  const prisma = fastify.prisma;

  // POST /api/v1/auth/login — the only unauthenticated API route
  fastify.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { username: body.username } });
    // Same message for wrong user and wrong password — never confirm which
    // half was right to someone probing the login.
    const ok = user?.isActive && (await bcrypt.compare(body.password, user.passwordHash));
    if (!ok || !user) {
      return reply.status(401).send({ success: false, error: 'Wrong username or password' });
    }

    const token = fastify.jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      { expiresIn: '7d' },
    );
    return reply.send({
      success: true,
      data: { token, user: { id: user.id, username: user.username, role: user.role } },
    });
  });

  // GET /api/v1/auth/me — who does this token belong to?
  fastify.get('/me', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    return reply.send({ success: true, data: request.user });
  });

  // POST /api/v1/auth/change-password
  fastify.post(
    '/change-password',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const body = changePasswordSchema.parse(request.body);
      const user = await prisma.user.findUnique({ where: { id: request.user.id } });
      if (!user || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
        return reply.status(400).send({ success: false, error: 'Current password is wrong' });
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(body.newPassword, 10) },
      });
      return reply.send({ success: true, message: 'Password changed' });
    },
  );
}
