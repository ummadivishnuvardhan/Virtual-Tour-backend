import mongoose from "mongoose";
const DepartmentSchema = new mongoose.Schema({
    name:{type:String,required:true},
    description:String,
    rooms:[{type:mongoose.Schema.Types.ObjectId,ref:"Image"}]
});

export default mongoose.model("Department",DepartmentSchema);