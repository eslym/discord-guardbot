import { ContextError } from './context';

export function handleError(error: unknown) {
    if (error instanceof ContextError) {
        console.error(error.message);
        process.exit(1);
    }
    if (error instanceof Error) {
        if (process.env.NODE_ENV === 'production') {
            console.error(error.message);
        } else {
            console.error(error.stack);
        }
        return;
    }
    console.error(error);
}
