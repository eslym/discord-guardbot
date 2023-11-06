import { ConfigError } from './config';
import { ContextError } from './context';

export function handleError(error: unknown) {
    if (error instanceof ContextError) {
        console.error(error.message);
        process.exit(1);
    }
    if (error instanceof ConfigError) {
        console.error(error.message);
        if (error.validationError) {
            for (const issue of error.validationError.issues) {
                console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
            }
        }
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
