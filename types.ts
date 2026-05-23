export type User = {
    id: number
    avatar: string
    name: string
    password: string
    description: string
    isOnline: boolean
    chats: Chat[]
}

export type Chat = {
    id: number
    isGroup: false,
    user: {
        id: number
        avatar: string
        name: string
        isOnline: boolean
    },
    messages: Message[]
} | {
    id: number
    avatar: string
    title: string
    isGroup: boolean
    users: {
        id: number
        avatar: string
        name: string
        isOnline: boolean
    }[]
    createdUser: number
    messages: Message[]
}

export type Message = {
    id: number
    user: {
        id: number
        avatar: string
        name: string
    }
    text: string
    time: string
}