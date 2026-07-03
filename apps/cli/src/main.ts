import { Command } from 'commander';
import { ApiError, SurfGenClient, loadConfig, saveConfig } from './client.js';

const program = new Command('surfgen')
  .description('SurfGen — provider-agnostic AI video generation')
  .version('0.1.0')
  .option('--api <url>', 'API base URL (defaults to config / SURFGEN_API_URL)');

const client = () => {
  const config = loadConfig();
  const apiOverride = program.opts<{ api?: string }>().api;
  return new SurfGenClient(apiOverride ? { ...config, apiUrl: apiOverride } : config);
};

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2)); // eslint-disable-line no-console

function run(action: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError) {
        console.error(`✗ ${error.code}: ${error.message}`);
      } else {
        console.error(`✗ ${String(error)}`);
      }
      process.exitCode = 1;
    }
  };
}

// ------------------------------------------------------------------------ auth
const auth = program.command('auth').description('authentication');

auth
  .command('login')
  .requiredOption('--email <email>')
  .requiredOption('--password <password>')
  .action((options: { email: string; password: string }) =>
    run(async () => {
      const config = loadConfig();
      const { data } = await new SurfGenClient(config).request<{
        accessToken: string;
        refreshToken: string;
      }>('POST', '/v1/auth/login', options);
      saveConfig({ ...config, accessToken: data.accessToken, refreshToken: data.refreshToken });
      console.error('✓ logged in');
    })(),
  );

auth
  .command('use-key')
  .description('authenticate with an API key instead of a login')
  .argument('<apiKey>')
  .action((apiKey: string) =>
    run(async () => {
      saveConfig({ ...loadConfig(), apiKey });
      console.error('✓ API key stored');
    })(),
  );

auth.command('logout').action(() =>
  run(async () => {
    const config = loadConfig();
    if (config.refreshToken) {
      await new SurfGenClient(config)
        .request('POST', '/v1/auth/logout', { refreshToken: config.refreshToken })
        .catch(() => {});
    }
    saveConfig({ apiUrl: config.apiUrl });
    console.error('✓ logged out');
  })(),
);

// ------------------------------------------------------------------------ orgs
const orgs = program.command('orgs').description('organizations');

orgs.command('list').action(() =>
  run(async () => print((await client().request('GET', '/v1/orgs')).data))(),
);

orgs
  .command('use')
  .argument('<orgId>')
  .description('set the default organization')
  .action((orgId: string) =>
    run(async () => {
      saveConfig({ ...loadConfig(), defaultOrgId: orgId });
      console.error(`✓ default org: ${orgId}`);
    })(),
  );

// -------------------------------------------------------------------- projects
const projects = program.command('projects').description('projects');

const requireOrg = (): string => {
  const orgId = loadConfig().defaultOrgId;
  if (!orgId) throw new Error("no default org — run 'surfgen orgs use <orgId>'");
  return orgId;
};

projects.command('list').action(() =>
  run(async () =>
    print((await client().request('GET', `/v1/orgs/${requireOrg()}/projects`)).data),
  )(),
);

projects
  .command('create')
  .requiredOption('--name <name>')
  .option('--description <description>')
  .action((options: { name: string; description?: string }) =>
    run(async () =>
      print((await client().request('POST', `/v1/orgs/${requireOrg()}/projects`, options)).data),
    )(),
  );

projects
  .command('use')
  .argument('<projectId>')
  .action((projectId: string) =>
    run(async () => {
      saveConfig({ ...loadConfig(), defaultProjectId: projectId });
      console.error(`✓ default project: ${projectId}`);
    })(),
  );

// ---------------------------------------------------------------------- videos
const videos = program.command('videos').description('videos');

const requireProject = (): { orgId: string; projectId: string } => {
  const config = loadConfig();
  if (!config.defaultOrgId || !config.defaultProjectId) {
    throw new Error("set defaults first: 'surfgen orgs use <id>' and 'surfgen projects use <id>'");
  }
  return { orgId: config.defaultOrgId, projectId: config.defaultProjectId };
};

videos.command('list').action(() =>
  run(async () => {
    const { orgId, projectId } = requireProject();
    print((await client().request('GET', `/v1/orgs/${orgId}/projects/${projectId}/videos`)).data);
  })(),
);

videos
  .command('create')
  .requiredOption('--title <title>')
  .option('--script <script>', 'presenter script (omit to have the LLM write one)')
  .option('--language <language>', 'BCP-47 tag', 'en')
  .option('--voice <voiceId>')
  .option('--avatar <avatarId>')
  .option('--generate', 'immediately queue generation after creating')
  .action(
    (options: {
      title: string;
      script?: string;
      language: string;
      voice?: string;
      avatar?: string;
      generate?: boolean;
    }) =>
      run(async () => {
        const { orgId, projectId } = requireProject();
        const api = client();
        const { data: video } = await api.request<{ id: string }>(
          'POST',
          `/v1/orgs/${orgId}/projects/${projectId}/videos`,
          {
            title: options.title,
            language: options.language,
            ...(options.script && { script: options.script }),
            ...(options.voice && { voiceId: options.voice }),
            ...(options.avatar && { avatarId: options.avatar }),
          },
        );
        if (options.generate) {
          const { data: queued } = await api.request(
            'POST',
            `/v1/orgs/${orgId}/projects/${projectId}/videos/${video.id}/generate`,
          );
          print(queued);
        } else {
          print(video);
        }
      })(),
  );

videos
  .command('status')
  .argument('<videoId>')
  .action((videoId: string) =>
    run(async () => {
      const { orgId, projectId } = requireProject();
      print(
        (await client().request('GET', `/v1/orgs/${orgId}/projects/${projectId}/videos/${videoId}`))
          .data,
      );
    })(),
  );

videos
  .command('generate')
  .argument('<videoId>')
  .action((videoId: string) =>
    run(async () => {
      const { orgId, projectId } = requireProject();
      print(
        (
          await client().request(
            'POST',
            `/v1/orgs/${orgId}/projects/${projectId}/videos/${videoId}/generate`,
          )
        ).data,
      );
    })(),
  );

videos
  .command('cancel')
  .argument('<videoId>')
  .action((videoId: string) =>
    run(async () => {
      const { orgId, projectId } = requireProject();
      print(
        (
          await client().request(
            'POST',
            `/v1/orgs/${orgId}/projects/${projectId}/videos/${videoId}/cancel`,
          )
        ).data,
      );
    })(),
  );

program.parseAsync().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
