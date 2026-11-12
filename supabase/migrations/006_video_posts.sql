-- Rode no SQL Editor do Supabase: quantos vídeos foram postados em cada dia (página "Seus vídeos" da Estatísticas).

create table if not exists public.video_posts (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,                        -- dia da postagem
  count integer not null check (count >= 0), -- quantos vídeos nesse dia (gravar de novo substitui)
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.video_posts enable row level security;
drop policy if exists "owner" on public.video_posts;
create policy "owner" on public.video_posts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
