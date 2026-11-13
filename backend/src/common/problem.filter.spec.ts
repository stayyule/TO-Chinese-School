import { ArgumentsHost, BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { AppError } from './errors';
import { logger } from './logger';
import { ProblemFilter } from './problem.filter';

function hostFor(requestId: string): { host: ArgumentsHost; res: { status: jest.Mock; json: jest.Mock } } {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ requestId }), getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('ProblemFilter logging', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => errorSpy.mockRestore());

  it('logs a 5xx HttpException with status, requestId and error name only (no message)', () => {
    const { host, res } = hostFor('req-1');
    new ProblemFilter().catch(new ServiceUnavailableException('db password=hunter2 unreachable'), host);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [obj, msg] = errorSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(obj).toEqual({ requestId: 'req-1', status: 503, errName: 'ServiceUnavailableException' });
    expect(msg).toBe('http exception');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('hunter2');
  });

  it('logs a bare 500 HttpException too', () => {
    const { host } = hostFor('req-2');
    new ProblemFilter().catch(new HttpException('boom', 500), host);
    expect(errorSpy).toHaveBeenCalledWith({ requestId: 'req-2', status: 500, errName: 'HttpException' }, 'http exception');
  });

  it('does not log 4xx HttpExceptions or AppErrors', () => {
    const { host } = hostFor('req-3');
    new ProblemFilter().catch(new BadRequestException('nope'), host);
    new ProblemFilter().catch(new AppError(503, 'X', 'app-level'), host);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('still logs unknown exceptions as unhandled', () => {
    const { host, res } = hostFor('req-4');
    const err = new Error('kaput');
    new ProblemFilter().catch(err, host);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(errorSpy).toHaveBeenCalledWith({ requestId: 'req-4', err }, 'unhandled exception');
  });
});
