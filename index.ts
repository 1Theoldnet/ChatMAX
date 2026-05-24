import express, { Request, Response } from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { PeerServer } from 'peer'
import cors from 'cors'
import { Chat, Message, User } from './types'

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

const server = createServer(app)

// Настройка Socket.IO
const io = new Server(server, {
    cors: { origin: '*' }
})

// Настройка PeerJS сервера
const peerServer = PeerServer({
    port: 3001,
    path: '/peerjs',
    allow_discovery: true
})

app.set('io', io)

const users: User[] = []

// Хранилище активных звонков
interface ActiveCall {
    callId: string
    fromUserId: number
    toUserId: number
    chatId: number
    isVideo: boolean
    startTime: Date
    status: 'ringing' | 'active' | 'ended'
}

const activeCalls = new Map<string, ActiveCall>()

const generateId = (): number => {
    const now = new Date()
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    const seconds = String(now.getSeconds()).padStart(2, '0')
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const year = now.getFullYear()
    
    return Number(`${hours}${minutes}${seconds}${milliseconds}${day}${month}${year}`)
}

const generateCallId = (): string => {
    return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// API endpoints
app.get('/users', (_, res: Response) => res.json(users))

app.get('/user/:id', (req: Request, res: Response) => {
    const user = users.find(user => user.id === parseInt(req.params.id as string))

    if(!user) {
        return res.json({ message: 'Аккаунт не существует!' })
    }

    res.json(user)
})

app.post('/user/register', (req: Request, res: Response) => {
    const { avatar = '', name, password, description = '' } = req.body

    const existUser = users.find(user => user.name === name && user.password === password)
    
    if(existUser) {
        return res.json({ message: 'Такой аккаунт уже существует!' })
    }

    const newUser = {
        id: generateId(),
        avatar,
        name,
        password,
        description,
        isOnline: false,
        chats: []
    }

    users.push(newUser)

    res.json({ message: 'Аккаунт успешно создан!', user: newUser })
})

app.post('/user/login', (req: Request, res: Response) => {
    const { name, password } = req.body

    const existUser = users.find(user => user.name === name && user.password === password)
    
    if(!existUser) {
        return res.json({ message: 'Невеный пароль или имя' })
    }

    res.json({ message: 'Вы успешно вошли в аккаунт!', user: existUser })
})

app.post('/chat/create/no-group', (req: Request, res: Response) => {
    const { userId, toUserId } = req.body

    const existUser = users.find(user => user.id === userId)
    const existUserToUserId = users.find(user => user.id === toUserId)

    if(existUser && existUserToUserId) {
        const genId = generateId()

        const newChatForUserId: Chat = {
            id: genId,
            isGroup: false,
            user: {
                id: existUserToUserId.id,
                avatar: existUserToUserId.avatar,
                name: existUserToUserId.name,
                isOnline: existUserToUserId.isOnline
            },
            messages: []
        }

        const newChatForToUserId: Chat = {
            id: genId,
            isGroup: false,
            user: {
                id: existUser.id,
                avatar: existUser.avatar,
                name: existUser.name,
                isOnline: existUser.isOnline
            },
            messages: []
        }

        existUser.chats.push(newChatForUserId)
        existUserToUserId.chats.push(newChatForToUserId)
        
        io.to(`user:${existUser.id}`).emit('chat-created', { chat: newChatForUserId })
        io.to(`user:${existUserToUserId.id}`).emit('chat-created', { chat: newChatForToUserId })
        
        return res.json({ message: 'Чат успешно создан!' })
    }
})

app.post('/chat/create/group', (req: Request, res: Response) => {
    const { avatar = '', title, createdUser, userIds } = req.body
    
    const groupUsers = [...new Set([createdUser, ...userIds])]
        .map(id => users.find(u => u.id === id))
        .filter(u => u)
    
    const newGroupChat: Chat = {
        id: generateId(),
        avatar,
        title,
        isGroup: true,
        users: groupUsers.map(user => ({
            id: user!.id,
            avatar: user!.avatar,
            name: user!.name,
            isOnline: user!.isOnline
        })),
        createdUser: createdUser,
        messages: []
    }
    
    groupUsers.forEach(user => {
        user!.chats.push(newGroupChat)
        io.to(`user:${user!.id}`).emit('group-created', { chat: newGroupChat })
    })
    
    res.json({ chat: newGroupChat })
})

app.delete('/chat/delete/no-group', (req: Request, res: Response) => {
    const { userId, toUserId, chatId } = req.body

    const existUser = users.find(user => user.id === userId)
    const existUserToUserId = users.find(user => user.id === toUserId)

    if(existUser && existUserToUserId) {
        const userChatIndex = existUser.chats.findIndex(chat => chat.id === chatId)
        const toUserChatIndex = existUserToUserId.chats.findIndex(chat => chat.id === chatId)

        if(userChatIndex !== -1 && toUserChatIndex !== -1) {
            existUser.chats.splice(userChatIndex, 1)
            existUserToUserId.chats.splice(toUserChatIndex, 1)
            
            io.to(`user:${existUser.id}`).emit('chat-deleted', { chatId: chatId })
            io.to(`user:${existUserToUserId.id}`).emit('chat-deleted', { chatId: chatId })

            return res.json({ message: 'Чат успешно удален!' })
        }
    }
    
    return res.json({ message: 'Чат не найден!' })
})

app.delete('/chat/delete/group', (req: Request, res: Response) => {
    const { userId, chatId } = req.body

    const existUser = users.find(user => user.id === userId)
    
    if(!existUser) {
        return res.json({ message: 'Пользователь не найден!' })
    }

    const groupChat = existUser.chats.find(chat => chat.id === chatId && chat.isGroup === true) as Chat & { isGroup: true } | undefined
    
    if(!groupChat) {
        return res.json({ message: 'Групповой чат не найден!' })
    }
    
    if(groupChat.createdUser !== userId) {
        return res.json({ message: 'Только создатель группы может удалить чат!' })
    }

    groupChat.users.forEach(participant => {
        const user = users.find(u => u.id === participant.id)
        if(user) {
            user.chats = user.chats.filter(chat => chat.id !== chatId)
            io.to(`user:${participant.id}`).emit('chat-deleted', { chatId: chatId })
        }
    })
    
    res.json({ message: 'Групповой чат успешно удален!' })
})

app.post('/message/create/no-group', (req: Request, res: Response) => {
    const { userId, chatId, text, photo, video, audio } = req.body

    const user = users.find(u => u.id === userId)
    
    if(user) {
        const chat = user.chats.find(c => c.id === chatId)
        
        if(chat && !chat.isGroup) {
            const newMessage: Message = {
                id: generateId(),
                user: {
                    id: user.id,
                    avatar: user.avatar,
                    name: user.name
                },
                text,
                photo,
                video,
                audio,
                time: new Date().toLocaleTimeString()
            }
            
            chat.messages.push(newMessage)
            
            const toUser = users.find(u => u.id === (chat as any).user.id)
            if(toUser) {
                const toUserChat = toUser.chats.find(c => c.id === chatId)
                if(toUserChat && !toUserChat.isGroup) {
                    toUserChat.messages.push(newMessage)
                }
                
                io.to(`user:${toUser.id}`).emit('new-message', {
                    chatId: chatId,
                    message: newMessage
                })
            }
            
            io.to(`user:${user.id}`).emit('new-message', {
                chatId,
                message: newMessage
            })
            
            return res.json({ message: 'Сообщение отправлено!', msg: newMessage })
        }
    }
    
    res.json({ message: 'Ошибка при отправке сообщения!' })
})

app.post('/message/create/group', (req: Request, res: Response) => {
    const { userId, chatId, text, photo, video, audio } = req.body

    const user = users.find(u => u.id === userId)
    
    if(user) {
        const chat = user.chats.find(c => c.id === chatId && c.isGroup)
        
        if(chat && chat.isGroup) {
            const newMessage: Message = {
                id: generateId(),
                user: {
                    id: user.id,
                    avatar: user.avatar,
                    name: user.name
                },
                text,
                photo,
                video,
                audio,
                time: new Date().toLocaleTimeString()
            }
            
            chat.messages.push(newMessage)
            
            chat.users.forEach(participant => {
                const groupUser = users.find(u => u.id === participant.id)
                if(groupUser) {
                    const userChat = groupUser.chats.find(c => c.id === chatId)
                    if(userChat && userChat.isGroup) {
                        userChat.messages.push(newMessage)
                    }
                    io.to(`user:${participant.id}`).emit('new-message', {
                        chatId,
                        message: newMessage
                    })
                }
            })
            
            return res.json({ message: 'Сообщение отправлено в группу!', msg: newMessage })
        }
    }
    
    res.json({ message: 'Ошибка при отправке сообщения в группу!' })
})

app.delete('/message/delete/no-group', (req: Request, res: Response) => {
    const { userId, chatId, messageId } = req.body

    const user = users.find(u => u.id === userId)
    
    if(user) {
        const chat = user.chats.find(c => c.id === chatId && !c.isGroup)
        
        if(chat && !chat.isGroup) {
            const messageIndex = chat.messages.findIndex(m => m.id === messageId)
            
            if(messageIndex !== -1) {
                chat.messages.splice(messageIndex, 1)
                
                const toUser = users.find(u => u.id === (chat as any).user.id)
                if(toUser) {
                    const toUserChat = toUser.chats.find(c => c.id === chatId)
                    if(toUserChat && !toUserChat.isGroup) {
                        const toUserMessageIndex = toUserChat.messages.findIndex(m => m.id === messageId)
                        if(toUserMessageIndex !== -1) {
                            toUserChat.messages.splice(toUserMessageIndex, 1)
                        }
                    }
                    
                    io.to(`user:${toUser.id}`).emit('message-deleted', {
                        chatId: chatId,
                        messageId: messageId
                    })
                }
                
                io.to(`user:${user.id}`).emit('message-deleted', {
                    chatId: chatId,
                    messageId: messageId
                })
                
                return res.json({ message: 'Сообщение удалено у обоих пользователей!' })
            }
        }
    }
    
    res.json({ message: 'Ошибка при удалении сообщения!' })
})

app.delete('/message/delete/group', (req: Request, res: Response) => {
    const { userId, chatId, messageId } = req.body

    const user = users.find(u => u.id === userId)
    
    if(user) {
        const chat = user.chats.find(c => c.id === chatId && c.isGroup)
        
        if(chat && chat.isGroup) {
            const messageIndex = chat.messages.findIndex(m => m.id === messageId)
            
            if(messageIndex !== -1) {
                const message = chat.messages[messageIndex]
                
                if(message.user.id === userId || chat.createdUser === userId) {
                    chat.users.forEach(participant => {
                        const groupUser = users.find(u => u.id === participant.id)
                        if(groupUser) {
                            const userChat = groupUser.chats.find(c => c.id === chatId)
                            if(userChat && userChat.isGroup) {
                                const msgIndex = userChat.messages.findIndex(m => m.id === messageId)
                                if(msgIndex !== -1) {
                                    userChat.messages.splice(msgIndex, 1)
                                }
                            }
                            io.to(`user:${participant.id}`).emit('message-deleted', {
                                chatId: chatId,
                                messageId: messageId
                            })
                        }
                    })
                    
                    return res.json({ message: 'Сообщение удалено из группы!' })
                }
                
                return res.json({ message: 'Нет прав для удаления сообщения!' })
            }
        }
    }
    
    res.json({ message: 'Ошибка при удалении сообщения!' })
})

app.delete('/message/delete/only-me', (req: Request, res: Response) => {
    const { userId, chatId, messageId } = req.body

    const user = users.find(u => u.id === userId)
    
    if(user) {
        const chat = user.chats.find(c => c.id === chatId)
        
        if(chat) {
            const messageIndex = chat.messages.findIndex(m => m.id === messageId)
            
            if(messageIndex !== -1) {
                chat.messages.splice(messageIndex, 1)
                io.to(`user:${user.id}`).emit('message-deleted-only-me', {
                    chatId: chatId,
                    messageId: messageId
                })
                return res.json({ message: 'Сообщение удалено только у вас!' })
            }
        }
    }
    
    res.json({ message: 'Ошибка при удалении сообщения!' })
})

app.delete('/message/delete/all-only-me', (req: Request, res: Response) => {
    const { userId, chatId } = req.body

    const user = users.find(u => u.id === userId)
    
    if(user) {
        const chat = user.chats.find(c => c.id === chatId)
        
        if(chat) {
            const deletedCount = chat.messages.length
            chat.messages = []
            io.to(`user:${user.id}`).emit('all-messages-deleted', {
                chatId: chatId,
                count: deletedCount
            })
            return res.json({ message: `Удалено ${deletedCount} сообщений только у вас!` })
        }
    }
    
    res.json({ message: 'Ошибка при удалении сообщений!' })
})

// Socket.IO с сигнализацией для PeerJS
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id)

    let currentUserId: number | null = null

    socket.on('user-connected', (userId: number) => {
        currentUserId = userId
        socket.join(`user:${userId}`)
        
        const user = users.find(u => u.id === userId)
        if(user && !user.isOnline) {
            user.isOnline = true
            console.log(`User ${user.name} (${userId}) is online`)
            io.emit('user-status-changed', {
                userId: userId,
                isOnline: true
            })
        }
    })
    
    socket.on('typing', (data: { chatId: number, userId: number, isTyping: boolean }) => {
        const user = users.find(u => u.id === data.userId)
        if(user) {
            const chat = user.chats.find(c => c.id === data.chatId)
            if(chat) {
                if(!chat.isGroup) {
                    const toUserId = (chat as any).user.id
                    socket.to(`user:${toUserId}`).emit('user-typing', {
                        chatId: data.chatId,
                        userId: data.userId,
                        isTyping: data.isTyping
                    })
                } else {
                    chat.users.forEach(participant => {
                        if(participant.id !== data.userId) {
                            socket.to(`user:${participant.id}`).emit('user-typing', {
                                chatId: data.chatId,
                                userId: data.userId,
                                isTyping: data.isTyping
                            })
                        }
                    })
                }
            }
        }
    })
    
    // ============ PEERJS ЗВОНКИ ============
    
    // Инициация звонка через PeerJS
    socket.on('call-user', (data: {
        callId: string,
        from: number,
        to: number,
        chatId: number,
        isVideo: boolean,
        peerId: string
    }) => {
        console.log(`📞 PeerJS call from ${data.from} to ${data.to}, video: ${data.isVideo}`)
        
        const call: ActiveCall = {
            callId: data.callId,
            fromUserId: data.from,
            toUserId: data.to,
            chatId: data.chatId,
            isVideo: data.isVideo,
            startTime: new Date(),
            status: 'ringing'
        }
        
        activeCalls.set(data.callId, call)
        
        // Отправляем получателю информацию о звонке с PeerId звонящего
        io.to(`user:${data.to}`).emit('incoming-call', {
            callId: data.callId,
            from: data.from,
            chatId: data.chatId,
            isVideo: data.isVideo,
            fromPeerId: data.peerId
        })
        
        // Таймаут для неотвеченного звонка
        setTimeout(() => {
            const activeCall = activeCalls.get(data.callId)
            if (activeCall && activeCall.status === 'ringing') {
                activeCall.status = 'ended'
                activeCalls.delete(data.callId)
                io.to(`user:${data.from}`).emit('call-timeout', {
                    callId: data.callId,
                    chatId: data.chatId
                })
            }
        }, 30000)
    })
    
    // Принятие звонка
    socket.on('answer-call', (data: {
        callId: string,
        to: number,
        chatId: number,
        peerId: string
    }) => {
        console.log(`✅ PeerJS call ${data.callId} answered by ${data.to}`)
        
        const call = activeCalls.get(data.callId)
        if (call && call.status === 'ringing') {
            call.status = 'active'
            io.to(`user:${call.fromUserId}`).emit('call-answered', {
                callId: data.callId,
                chatId: data.chatId,
                peerId: data.peerId
            })
        }
    })
    
    // Отклонение звонка
    socket.on('reject-call', (data: {
        callId: string,
        to: number,
        chatId: number
    }) => {
        console.log(`❌ PeerJS call ${data.callId} rejected by ${data.to}`)
        
        const call = activeCalls.get(data.callId)
        if (call) {
            call.status = 'ended'
            activeCalls.delete(data.callId)
            io.to(`user:${call.fromUserId}`).emit('call-rejected', {
                callId: data.callId,
                chatId: data.chatId
            })
        }
    })
    
    // Завершение звонка
    socket.on('end-call', (data: {
        callId: string,
        chatId: number,
        userId: number
    }) => {
        console.log(`🔚 Ending PeerJS call ${data.callId} by user ${data.userId}`)
        
        const call = activeCalls.get(data.callId)
        if (call) {
            call.status = 'ended'
            const otherUserId = call.fromUserId === data.userId ? call.toUserId : call.fromUserId
            io.to(`user:${otherUserId}`).emit('call-ended', {
                callId: data.callId,
                chatId: data.chatId,
                endedBy: data.userId
            })
            activeCalls.delete(data.callId)
        }
    })
    
    // Heartbeat
    let heartbeatInterval: NodeJS.Timeout
    
    const startHeartbeat = () => {
        heartbeatInterval = setInterval(() => {
            if (socket.connected) {
                socket.emit('ping')
            }
        }, 30000)
    }
    
    const stopHeartbeat = () => {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval)
        }
    }
    
    socket.on('pong', () => {})

    // Добавьте обработчики для PeerJS сигналов
socket.on('peer-call-initiated', (data) => {
    const { from, to, chatId, isVideo } = data
    io.to(`user:${to}`).emit('incoming-call', {
        from,
        chatId,
        isVideo,
        fromPeerId: users.find(u => u.id === from)?.peerId
    })
})

socket.on('peer-call-answered', (data) => {
    const { to, chatId } = data
    io.to(`user:${to}`).emit('call-answered', { chatId })
})

socket.on('peer-call-rejected', (data) => {
    const { to, chatId } = data
    io.to(`user:${to}`).emit('call-rejected', { chatId })
})

socket.on('peer-call-ended', (data) => {
    const { chatId, userId } = data
    io.emit('call-ended', { chatId, endedBy: userId })
})
    
    startHeartbeat()
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id)
        stopHeartbeat()
        
        if (currentUserId) {
            const user = users.find(u => u.id === currentUserId)
            if (user && user.isOnline) {
                user.isOnline = false
                console.log(`User ${user.name} (${currentUserId}) is offline`)
                io.emit('user-status-changed', {
                    userId: currentUserId,
                    isOnline: false
                })
            }
            
            // Завершаем активные звонки пользователя
            const userCalls = Array.from(activeCalls.values()).filter(
                call => call.fromUserId === currentUserId || call.toUserId === currentUserId
            )
            
            userCalls.forEach(call => {
                const otherUserId = call.fromUserId === currentUserId ? call.toUserId : call.fromUserId
                io.to(`user:${otherUserId}`).emit('call-ended', {
                    callId: call.callId,
                    chatId: call.chatId,
                    endedBy: currentUserId,
                    reason: 'disconnected'
                })
                activeCalls.delete(call.callId)
            })
        }
    })
})

// Запуск серверов
const HTTP_PORT = 3000
const PEER_PORT = 3001

server.listen(HTTP_PORT, () => {
    console.log(`HTTP Server running on port ${HTTP_PORT}`)
    console.log(`PeerJS Server running on port ${PEER_PORT}`)
})
