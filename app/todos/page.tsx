import TodosView from '@/app/_board/TodosView';
import { requireAccount } from '@/lib/access';
import { listTodos } from '@/lib/todos';

// To-dos (REQUIREMENTS W-35, W-36): every card across the person's projects,
// as a board by status or a list. The project cards on the board link here
// filtered to one project (?project=).

export const metadata = { title: 'To-dos · Bottega' };

type Props = { searchParams?: Promise<{ project?: string }> };

export default async function TodosPage({ searchParams }: Props) {
  const { db } = await requireAccount();
  const todos = await listTodos(db);
  const asked = Number((await searchParams)?.project);
  return <TodosView initial={todos} project={Number.isInteger(asked) && asked > 0 ? asked : null} />;
}
