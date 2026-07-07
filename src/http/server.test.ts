import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createHttpServer } from './server.js';

vi.mock('../commands/executeCommand.js');

// Get the mocked module
import * as executeCommandModule from '../commands/executeCommand.js';

describe('createHttpServer', () => {
  const fakeSupabase = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeCommandModule.executeCommand).mockImplementation(async () => ({
      status: 'done',
      result: { groups: [['a', 'b']] },
    }));
  });

  it('rejects requests with missing x-bot-api-secret header and does not call executeCommand', async () => {
    const app = createHttpServer(fakeSupabase, 'correct-secret');
    const res = await request(app)
      .post('/commands/randomize')
      .send({ params: { memberIds: ['a', 'b'], maxGroupSize: 6 }, idempotencyKey: 'k1', requestedBy: 'admin1' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('missing x-bot-api-secret header');
    expect(vi.mocked(executeCommandModule.executeCommand)).not.toHaveBeenCalled();
  });

  it('rejects requests with invalid x-bot-api-secret and does not call executeCommand', async () => {
    const app = createHttpServer(fakeSupabase, 'correct-secret');
    const res = await request(app)
      .post('/commands/randomize')
      .set('x-bot-api-secret', 'wrong-secret')
      .send({ params: { memberIds: ['a', 'b'], maxGroupSize: 6 }, idempotencyKey: 'k1', requestedBy: 'admin1' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid x-bot-api-secret');
    expect(vi.mocked(executeCommandModule.executeCommand)).not.toHaveBeenCalled();
  });

  it('rejects requests with correct auth but missing idempotencyKey', async () => {
    const app = createHttpServer(fakeSupabase, 'correct-secret');
    const res = await request(app)
      .post('/commands/randomize')
      .set('x-bot-api-secret', 'correct-secret')
      .send({ params: { memberIds: ['a', 'b'] }, requestedBy: 'admin1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('idempotencyKey is required');
    expect(vi.mocked(executeCommandModule.executeCommand)).not.toHaveBeenCalled();
  });

  it('rejects requests with correct auth but empty idempotencyKey', async () => {
    const app = createHttpServer(fakeSupabase, 'correct-secret');
    const res = await request(app)
      .post('/commands/randomize')
      .set('x-bot-api-secret', 'correct-secret')
      .send({ params: { memberIds: ['a', 'b'] }, idempotencyKey: '', requestedBy: 'admin1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('idempotencyKey is required');
    expect(vi.mocked(executeCommandModule.executeCommand)).not.toHaveBeenCalled();
  });

  it('rejects requests with correct auth but missing requestedBy', async () => {
    const app = createHttpServer(fakeSupabase, 'correct-secret');
    const res = await request(app)
      .post('/commands/randomize')
      .set('x-bot-api-secret', 'correct-secret')
      .send({ params: { memberIds: ['a', 'b'], maxGroupSize: 6 }, idempotencyKey: 'k1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('requestedBy is required');
    expect(vi.mocked(executeCommandModule.executeCommand)).not.toHaveBeenCalled();
  });

  it('rejects requests with correct auth but empty requestedBy', async () => {
    const app = createHttpServer(fakeSupabase, 'correct-secret');
    const res = await request(app)
      .post('/commands/randomize')
      .set('x-bot-api-secret', 'correct-secret')
      .send({ params: { memberIds: ['a', 'b'], maxGroupSize: 6 }, idempotencyKey: 'k1', requestedBy: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('requestedBy is required');
    expect(vi.mocked(executeCommandModule.executeCommand)).not.toHaveBeenCalled();
  });

  it('accepts requests with correct shared secret, valid idempotencyKey, and valid requestedBy', async () => {
    const app = createHttpServer(fakeSupabase, 'correct-secret');
    const res = await request(app)
      .post('/commands/randomize')
      .set('x-bot-api-secret', 'correct-secret')
      .send({ params: { memberIds: ['a', 'b'], maxGroupSize: 6 }, idempotencyKey: 'k1', requestedBy: 'admin1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'done' });
    expect(vi.mocked(executeCommandModule.executeCommand)).toHaveBeenCalled();
  });

  it('allows params to be omitted and defaults to empty object', async () => {
    const app = createHttpServer(fakeSupabase, 'correct-secret');
    const res = await request(app)
      .post('/commands/randomize')
      .set('x-bot-api-secret', 'correct-secret')
      .send({ idempotencyKey: 'k1', requestedBy: 'admin1' });
    expect(res.status).toBe(200);
    expect(vi.mocked(executeCommandModule.executeCommand)).toHaveBeenCalledWith(fakeSupabase, 'randomize', {}, 'k1', 'admin1');
  });
});
