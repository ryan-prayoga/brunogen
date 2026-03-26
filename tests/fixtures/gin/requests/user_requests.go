package main

type CreateUserRequest struct {
	Name     string   `json:"name" binding:"required,max=255"`
	Email    string   `json:"email" binding:"required,email"`
	Age      int      `json:"age" binding:"min=18"`
	Role     string   `json:"role" binding:"omitempty,oneof=user admin"`
	Password string   `json:"password" binding:"required,min=8"`
	Tags     []string `json:"tags"`
}

type UpdateUserRequest struct {
	Name string `json:"name" binding:"required,max=255"`
}
