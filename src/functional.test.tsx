import { FC } from 'react';
import { render, screen, act, cleanup } from '@testing-library/react';
import { ProxyObject, Store } from './Store';
import { ActionFnOptionsAny} from '../redux/createActionMap';
import { addListener, report, setCategories } from '../logging/Reporter';
import { StateProvider, useCreateStateHook, useStateContext } from './StateProvider';

describe('functional test for createStateHook', () => {
    interface RootState {
        isLoading: boolean;
        counter: {
            count: number;
        };
        header: {
            text: string;
            subText: string;
        };
        users: [{
            name: string;
            age: number;
        }];
    }

    const initialState: RootState = {
        isLoading: true,
        counter: {
            count: 0,
        },
        header: {
            text: "React App",
            subText: "Is Testing"
        },
        users: [{
            name: 'John Doe',
            age: 30,
        }]
    };

    setCategories("all");
    addListener((timestamp: number, category: string, message: string, details?: any) => {
        //console.log(message)
    });

    let store: Store<RootState>;

    afterEach(() => {
        cleanup(); // Clean up React components and DOM
    });

    const Provider: FC = () => {
        return (
            <StateProvider initialState={initialState}>
                <App />
            </StateProvider>
        );
    }

    const App: FC = () => {
        report("test", "Render App");
        const { store: appStore } = useStateContext<RootState>();
        store = appStore;

        const app = (
            <div className="App" data-testid="app">
                <AppHeader />
                <Loading />
                <UserList />
            </div>
        );
        return app;
    }

    const appHeaderActions = {
        setHeader: (text: string, subText: string, options: ActionFnOptionsAny) => {
            return { text, subText };
        }
    };

    const AppHeader: FC = jest.fn(() => {
        report("test", "Render AppHeader");

        const { text, subText } = useCreateStateHook<RootState, RootState['header']>(
            "$.header",
            initialState.header
        );
        const app = useCreateStateHook<RootState, RootState>(
            "$",
            initialState
        );

        const header = (
            <div
                className="AppHeader"
            >
                <h1>{text}</h1>
                <h4>{subText}</h4>
                <button data-testid="header-loading" onClick={() => app.isLoading = !app.isLoading}>{app.isLoading && "Stop Loading" || "Start Loading"}</button>
            </div>
        );

        return header;
    });

    const loadingActions = {
        setIsLoading: (isLoading: boolean) => isLoading
    }
    const Loading: FC = jest.fn(() => {
        report("test", "Render Loading");

        const { isLoading } = useCreateStateHook<RootState, RootState>(
            "$",
            initialState
        );

        if (!isLoading)
            return <></>;

        return (
            <div
                className="AppLoading"
                hidden={!isLoading}
            >
                Loading....
            </div>
        );
    })

    const userListActions = {
        
    }
    const UserList: FC = jest.fn(() => {
        report("test", "Render UserList");
        const { ...users } = useCreateStateHook<RootState, RootState['users']>(
            "$.users",
            initialState.users
        );

        const { isLoading } = useCreateStateHook<RootState, RootState>(
            "$",
            initialState
        );

        if (isLoading)
            return <></>;

        const userList = (
            <div
                className="UserList"
            >
                {
                    Object.keys(users).map((user, index) => <User key={index} userIndex={index} />)
                }
            </div>
        );

        return userList;
    })

    const userActions = {
        
    }
    const User: FC<{ userIndex: number }> = jest.fn(({ userIndex }) => {
        const { name, age } = useCreateStateHook<RootState, RootState['users'][number]>(
            `$.users.${userIndex}`,
            initialState.users[userIndex]
        );

        return (
            <div
                className="User"
            >
                <label>Name</label>:{name}
                <label>Age</label>:{age}
            </div>
        );
    });

    test('should render and update the application', async () => {
        render(<Provider />);

        const appEl = screen.getByTestId('app');
        const app = store.get("$") as unknown as RootState & ProxyObject;
        const header = store.get("$.header") as unknown as RootState['header'] & ProxyObject;
        const users = store.get("$.users") as unknown as RootState['users'] & ProxyObject;

        expect(users).toEqual([{ name: 'John Doe', age: 30 }]);
        expect(appEl.innerHTML).toEqual(`<div class="AppHeader"><h1>React App</h1><h4>Is Testing</h4><button data-testid="header-loading">Stop Loading</button></div><div class="AppLoading">Loading....</div>`)

        //use the loading button to switch the is loading switch
        const loadingBtn = screen.getByTestId('header-loading');
        await act(async () => {
            loadingBtn.click();
        });
        expect(appEl.innerHTML).toEqual(`<div class="AppHeader"><h1>React App</h1><h4>Is Testing</h4><button data-testid="header-loading">Start Loading</button></div><div class="UserList"><div class="User"><label>Name</label>:John Doe<label>Age</label>:30</div></div>`);

        //use the state to update the header
        await act(async () => {
            header.subText = "Is Still Testing";
        });
        expect(appEl.innerHTML).toEqual("<div class=\"AppHeader\"><h1>React App</h1><h4>Is Still Testing</h4><button data-testid=\"header-loading\">Start Loading</button></div><div class=\"UserList\"><div class=\"User\"><label>Name</label>:John Doe<label>Age</label>:30</div></div>");

        //add users through the state
        await act(async () => {
            users.push({
                name: "Don Johnson",
                age: 100
            });
            users.push({
                name: "Micheal Jackson",
                age: 70
            });
        });

        expect(appEl.innerHTML).toEqual("<div class=\"AppHeader\"><h1>React App</h1><h4>Is Still Testing</h4><button data-testid=\"header-loading\">Start Loading</button></div><div class=\"UserList\"><div class=\"User\"><label>Name</label>:John Doe<label>Age</label>:30</div><div class=\"User\"><label>Name</label>:Don Johnson<label>Age</label>:100</div><div class=\"User\"><label>Name</label>:Micheal Jackson<label>Age</label>:70</div></div>");


        await act(async () => {
            app.isLoading = true;
            app.isLoading = false;
            app.isLoading = true;
            app.isLoading = false;
            app.isLoading = true;
            app.isLoading = false;
            app.isLoading = true;
        });
    });
});